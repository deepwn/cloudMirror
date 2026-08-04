// ============================================================================
// src/worker/cron.ts — 定时任务 scheduler (上限 3 个 cron 触发器)
// ============================================================================
//
// Cloudflare Workers 限制最多 3 个 cron 触发器，任务已合并:
//
//   wrangler.toml [triggers]         → handler
//   */10 * * * *  = health-check      → runHealthCheck()
//   0 * * * *     = aggregate-usage   → aggregateUsage()
//   0 3 * * *     = daily-maintenance → runDailyMaintenance()
//       (合并: daily-cleanup + cleanup-logs + cleanup-audit + expire-limits)
// ============================================================================

import type { Env } from "./providers/types";
import { getAllProviders } from "../providers/registry";
import { cleanupExpiredData } from "./db";

/** 单次 cron 运行最大删除行数，防止 D1 配额超限 */
const CRON_BATCH_LIMIT = 5000;

/** 默认保留天数（DB 未配置时回退） */
const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_AUDIT_MAX_ROWS = 100000;

/** capture 录制日志默认保留天数 */
const DEFAULT_CAPTURE_RETENTION_DAYS = 30;

/**
 * scheduled handler 入口。
 * Cloudflare Workers 限制 3 个 cron 触发器，每日维护任务已合并到 0 3 * * *。
 */
export async function handleCron(
  event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  switch (event.cron) {
    case "*/10 * * * *":
      console.log("[cron] health-check — running upstream probes");
      await runHealthCheck(env);
      break;
    case "0 * * * *":
      console.log("[cron] aggregate-usage — aggregating usage_logs → daily_usage");
      await aggregateUsage(env);
      break;
    case "0 3 * * *":
      console.log("[cron] daily-maintenance — running all maintenance tasks");
      await runDailyMaintenance(env);
      break;
    default:
      console.log(`[cron] unknown trigger: ${event.cron}`);
  }
}

// ============================================================================
// Task Implementations
// ============================================================================

/** 探测各 upstream 可用性 */
async function runHealthCheck(_env: Env): Promise<void> {
  try {
    const providers = getAllProviders();
    for (const provider of providers) {
      try {
        const result = await provider.healthCheck();
        if (!result.ok) {
          console.warn(`[health] ${provider.id} upstream unreachable (${result.latencyMs}ms)`);
        }
      } catch (err) {
        console.error(`[health] ${provider.id} check failed:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error("[health] provider scan failed:", (err as Error).message);
  }
}

/** 将 usage_logs 聚合到 daily_usage */
async function aggregateUsage(env: Env): Promise<void> {
  if (!env.DB) return;
  const today = new Date().toISOString().split("T")[0];

  try {
    // 聚合过去 24 小时的数据（防止遗漏）
    const { results: users } = await env.DB.prepare(
      "SELECT DISTINCT user_id FROM usage_logs WHERE created_at >= datetime('now', '-1 day')",
    ).all<{ user_id: string }>();

    for (const { user_id } of users) {
      // 按 provider 聚合
      const { results: providerRows } = await env.DB.prepare(`
        SELECT provider, COUNT(*) as cnt, SUM(bytes_in) as bin, SUM(bytes_out) as bout
        FROM usage_logs
        WHERE user_id = ? AND created_at >= datetime('now', '-1 day')
        GROUP BY provider
      `)
        .bind(user_id)
        .all<{ provider: string; cnt: number; bin: number; bout: number }>();

      for (const row of providerRows) {
        const id = `${user_id}:${today}:${row.provider}`;
        await env.DB.prepare(`
          INSERT INTO daily_usage (id, user_id, date, provider, requests, bytes_in, bytes_out)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            requests = requests + ?,
            bytes_in = bytes_in + ?,
            bytes_out = bytes_out + ?
        `)
          .bind(
            id,
            user_id,
            today,
            row.provider,
            row.cnt,
            row.bin,
            row.bout,
            row.cnt,
            row.bin,
            row.bout,
          )
          .run();
      }
    }
    console.log(`[cron] aggregate-usage done: ${users.length} users processed`);
  } catch (err) {
    console.error("[cron] aggregate-usage error:", (err as Error).message);
  }
}

/** 从 D1 settings 读取整数值，未配置时返回默认值 */
async function getSettingInt(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .bind(key)
      .first<{ value: string }>();
    if (row?.value) {
      const n = parseInt(row.value, 10);
      if (!isNaN(n) && n > 0) return n;
    }
  } catch {
    // ignore
  }
  return fallback;
}

/** 滚动删除过期 usage_logs（分批，防止 D1 配额超限） */
async function cleanupLogs(env: Env): Promise<void> {
  if (!env.DB) return;
  try {
    const retentionDays = await getSettingInt(env.DB, "log_retention_days", DEFAULT_RETENTION_DAYS);
    const { meta } = await env.DB.prepare(`
      DELETE FROM usage_logs
      WHERE id IN (
        SELECT id FROM usage_logs
        WHERE created_at < datetime('now', ?)
        ORDER BY created_at ASC
        LIMIT ?
      )
    `)
      .bind(`-${retentionDays} days`, CRON_BATCH_LIMIT)
      .run();
    const deleted = (meta?.rows_written ?? meta?.changed_db) ? CRON_BATCH_LIMIT : 0;
    console.log(
      `[cron] cleanup-logs: ~${deleted} rows deleted (retention: ${retentionDays}d, batch: ${CRON_BATCH_LIMIT})`,
    );
  } catch (err) {
    console.error("[cron] cleanup-logs error:", (err as Error).message);
  }
}

/** 滚动删除过期 audit_logs + 条数硬上限 */
async function cleanupAudit(env: Env): Promise<void> {
  if (!env.DB) return;
  try {
    const retentionDays = await getSettingInt(env.DB, "log_retention_days", DEFAULT_RETENTION_DAYS);
    const maxRows = await getSettingInt(env.DB, "audit_max_rows", DEFAULT_AUDIT_MAX_ROWS);

    // Step 1: 按时间滚动删除过期记录
    const { meta: timeMeta } = await env.DB.prepare(`
      DELETE FROM audit_logs
      WHERE id IN (
        SELECT id FROM audit_logs
        WHERE created_at < datetime('now', ?)
        ORDER BY created_at ASC
        LIMIT ?
      )
    `)
      .bind(`-${retentionDays} days`, CRON_BATCH_LIMIT)
      .run();
    const timeDeleted = timeMeta?.rows_written ?? (timeMeta?.changed_db ? CRON_BATCH_LIMIT : 0);

    // Step 2: 检查总行数是否超过硬上限，超过则从最旧开始删除
    const countRow = await env.DB.prepare("SELECT COUNT(*) as c FROM audit_logs").first<{
      c: number;
    }>();
    const currentCount = countRow?.c ?? 0;

    let overflowDeleted = 0;
    if (currentCount > maxRows) {
      const excess = currentCount - maxRows;
      const deleteN = Math.min(excess, CRON_BATCH_LIMIT);
      const { meta: overflowMeta } = await env.DB.prepare(`
        DELETE FROM audit_logs
        WHERE id IN (
          SELECT id FROM audit_logs
          ORDER BY created_at ASC
          LIMIT ?
        )
      `)
        .bind(deleteN)
        .run();
      overflowDeleted = overflowMeta?.rows_written ?? (overflowMeta?.changed_db ? deleteN : 0);
    }

    console.log(
      `[cron] cleanup-audit: time=${timeDeleted} overflow=${overflowDeleted} ` +
        `(retention: ${retentionDays}d, max: ${maxRows}, current: ${currentCount}, batch: ${CRON_BATCH_LIMIT})`,
    );
  } catch (err) {
    console.error("[cron] cleanup-audit error:", (err as Error).message);
  }
}

/**
 * 清理 capture 录制数据：
 *  1) 删除超过保留期的录制日志（滚动，防 D1 配额超限）；
 *  2) 删除已停用超过保留期的录制会话（含日志，CASCADE）。
 */
async function cleanupCapture(env: Env): Promise<void> {
  if (!env.DB) return;
  try {
    const retentionDays = await getSettingInt(
      env.DB,
      "capture_retention_days",
      DEFAULT_CAPTURE_RETENTION_DAYS,
    );
    // 1) 删除过期日志
    const { meta: logMeta } = await env.DB.prepare(`
      DELETE FROM capture_logs
      WHERE id IN (
        SELECT id FROM capture_logs
        WHERE created_at < datetime('now', ?)
        ORDER BY created_at ASC
        LIMIT ?
      )
    `)
      .bind(`-${retentionDays} days`, CRON_BATCH_LIMIT)
      .run();
    const logDeleted = logMeta?.rows_written ?? (logMeta?.changed_db ? CRON_BATCH_LIMIT : 0);

    // 2) 删除超期会话（级联删除其日志）
    const { meta: sessionMeta } = await env.DB.prepare(`
      DELETE FROM capture_sessions
      WHERE id IN (
        SELECT id FROM capture_sessions
        WHERE created_at < datetime('now', ?)
        ORDER BY created_at ASC
        LIMIT ?
      )
    `)
      .bind(`-${retentionDays} days`, CRON_BATCH_LIMIT)
      .run();
    const sessionDeleted =
      sessionMeta?.rows_written ?? (sessionMeta?.changed_db ? CRON_BATCH_LIMIT : 0);

    console.log(
      `[cron] cleanup-capture: logs=${logDeleted} sessions=${sessionDeleted} (retention: ${retentionDays}d, batch: ${CRON_BATCH_LIMIT})`,
    );
  } catch (err) {
    console.error("[cron] cleanup-capture error:", (err as Error).message);
  }
}

/** 暂停过期用户 */
async function expireLimits(env: Env): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`
      UPDATE users SET status = 'suspended', updated_at = datetime('now')
      WHERE id IN (
        SELECT user_id FROM user_limits
        WHERE expires_at IS NOT NULL AND expires_at < datetime('now')
      )
      AND status = 'active'
    `).run();
    console.log("[cron] expire-limits done");
  } catch (err) {
    console.error("[cron] expire-limits error:", (err as Error).message);
  }
}

/**
 * 每日统一维护任务 — 合并了原本分散在 4 个 cron 的所有维护操作。
 * 顺序执行：过期数据清理 → 用量日志滚动删除 → 审计日志清理 → 用户配额检查。
 * 单次 cron 执行 (D1 30s wall-time 限制)，各子任务失败不影响后续。
 */
async function runDailyMaintenance(env: Env): Promise<void> {
  if (!env.DB) return;

  const tasks: { name: string; fn: (env: Env) => Promise<void> }[] = [
    { name: "daily-cleanup", fn: dailyCleanup },
    { name: "cleanup-logs", fn: cleanupLogs },
    { name: "cleanup-audit", fn: cleanupAudit },
    { name: "cleanup-capture", fn: cleanupCapture },
    { name: "expire-limits", fn: expireLimits },
  ];

  for (const { name, fn } of tasks) {
    const started = Date.now();
    try {
      await fn(env);
      console.log(`[cron] ${name} done (${Date.now() - started}ms)`);
    } catch (err) {
      console.error(`[cron] ${name} failed:`, (err as Error).message);
    }
  }
}

/** 每日清理过期数据：软删除超 72h 用户 + 过期邀请码 */
async function dailyCleanup(env: Env): Promise<void> {
  if (!env.DB) return;
  try {
    const result = await cleanupExpiredData(env.DB);
    console.log(
      `[cron] daily-cleanup done: ${result.deletedUsers} users, ${result.expiredInvites} invites purged`,
    );
  } catch (err) {
    console.error("[cron] daily-cleanup error:", (err as Error).message);
  }
}
