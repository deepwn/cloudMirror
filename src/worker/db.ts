// ============================================================================
// src/worker/db.ts — D1 查询封装
// ============================================================================

import type {
  User,
  Credential,
  UserLimits,
  DailyUsage,
  UserProvider,
  ProviderSetting,
} from "../shared/types";
import { randomHex } from "./crypto";

function uuid(): string {
  return crypto.randomUUID();
}

// ============================================================================
// Users
// ============================================================================

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<User>();
  return row ?? null;
}

export async function getUserByHash(db: D1Database, hash: string): Promise<User | null> {
  const row = await db
    .prepare("SELECT * FROM users WHERE hash = ? AND status = ?")
    .bind(hash, "active")
    .first<User>();
  return row ?? null;
}

export async function getUserByUsername(db: D1Database, username: string): Promise<User | null> {
  const row = await db
    .prepare("SELECT * FROM users WHERE username = ?")
    .bind(username)
    .first<User>();
  return row ?? null;
}

/**
 * 生成唯一的 16 位 hex hash（碰撞重试最多 5 次）。
 */
async function generateUniqueHash(db: D1Database): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const hash = randomHex(16);
    const existing = await db
      .prepare("SELECT id FROM user_providers WHERE hash = ?")
      .bind(hash)
      .first();
    if (!existing) return hash;
  }
  throw new Error("Failed to generate unique hash after 5 attempts");
}

export async function createUser(
  db: D1Database,
  username: string,
  passwordHash: string,
  role: string = "user",
  email?: string,
): Promise<User> {
  const id = uuid();
  const limitsId = uuid();

  await db.batch([
    db
      .prepare(`
      INSERT INTO users (id, username, password, role, status, email)
      VALUES (?, ?, ?, ?, 'active', ?)
    `)
      .bind(id, username, passwordHash, role, email || null),
    db
      .prepare(`
      INSERT INTO user_limits (id, user_id, provider, rate_limit, bandwidth_limit, concurrency)
      VALUES (?, ?, '*', 600, 100, 10)
    `)
      .bind(limitsId, id),
  ]);

  return (await getUserById(db, id))!;
}

export async function updateUser(
  db: D1Database,
  id: string,
  fields: Partial<
    Pick<User, "username" | "password" | "role" | "status" | "email" | "note" | "deleted_at">
  >,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) {
      sets.push(`${k} = ?`);
      values.push(v);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(id);
  await db
    .prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

/** 软删除用户：设置 status='deleted' + deleted_at 时间戳，72h 后 cron 硬清理 */
export async function softDeleteUser(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      "UPDATE users SET status = 'deleted', deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    )
    .bind(id)
    .run();
}

/** 还原被软删除的用户（72h 内可操作） */
export async function restoreUser(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      "UPDATE users SET status = 'active', deleted_at = NULL, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(id)
    .run();
}

/** 硬删除用户（级联清除凭据/用量/审计等） */
export async function hardDeleteUser(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
}

/** 清理过期数据：软删除超 72h 的用户 + 过期邀请码 */
export async function cleanupExpiredData(
  db: D1Database,
): Promise<{ deletedUsers: number; expiredInvites: number }> {
  // 硬删除过期用户（status='deleted' 且 deleted_at 超过 72 小时）
  const userResult = await db
    .prepare(
      "DELETE FROM users WHERE status = 'deleted' AND deleted_at IS NOT NULL AND deleted_at < datetime('now', '-3 days')",
    )
    .run();

  // 清理过期邀请码（is_active=0 或 expires_at 过期超过 7 天）
  const inviteResult = await db
    .prepare(
      "DELETE FROM invite_codes WHERE expires_at < datetime('now', '-7 days') OR (is_active = 0 AND expires_at < datetime('now'))",
    )
    .run();

  return {
    deletedUsers: userResult.meta?.rows_written ?? 0,
    expiredInvites: inviteResult.meta?.rows_written ?? 0,
  };
}

export async function listUsers(
  db: D1Database,
  page = 1,
  pageSize = 50,
  search?: string,
): Promise<{ users: User[]; total: number }> {
  const cols = "id, username, role, status, email, note, deleted_at, created_at, updated_at";
  const offset = (page - 1) * pageSize;
  if (search) {
    const like = `%${search}%`;
    const total = await db
      .prepare("SELECT COUNT(*) as c FROM users WHERE username LIKE ? OR email LIKE ?")
      .bind(like, like)
      .first<{ c: number }>();
    const users = await db
      .prepare(
        `SELECT ${cols} FROM users WHERE username LIKE ? OR email LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(like, like, pageSize, offset)
      .all<Pick<User, keyof User>[]>();
    return { users: users.results as unknown as User[], total: total?.c ?? 0 };
  }
  const total = await db.prepare("SELECT COUNT(*) as c FROM users").first<{ c: number }>();
  const users = await db
    .prepare(`SELECT ${cols} FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(pageSize, offset)
    .all<Pick<User, keyof User>[]>();
  return { users: users.results as unknown as User[], total: total?.c ?? 0 };
}

// ============================================================================
// Credentials
// ============================================================================

export async function getCredentials(
  db: D1Database,
  userId: string,
  provider?: string,
): Promise<Credential[]> {
  if (provider) {
    const result = await db
      .prepare("SELECT * FROM credentials WHERE user_id = ? AND provider = ? AND is_active = 1")
      .bind(userId, provider)
      .all<Credential>();
    return result.results;
  }
  const result = await db
    .prepare("SELECT * FROM credentials WHERE user_id = ?")
    .bind(userId)
    .all<Credential>();
  return result.results;
}

export async function getCredentialById(db: D1Database, id: string): Promise<Credential | null> {
  const row = await db
    .prepare("SELECT * FROM credentials WHERE id = ?")
    .bind(id)
    .first<Credential>();
  return row ?? null;
}

export async function upsertCredential(
  db: D1Database,
  userId: string,
  provider: string,
  username: string,
  encryptedSecret: string,
  label: string,
): Promise<Credential> {
  const id = uuid();
  await db
    .prepare(`
    INSERT INTO credentials (id, user_id, provider, label, username, secret, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `)
    .bind(id, userId, provider, label, username, encryptedSecret)
    .run();
  return (await getCredentialById(db, id))!;
}

export async function updateCredential(
  db: D1Database,
  id: string,
  fields: Partial<Pick<Credential, "label" | "username" | "secret" | "is_active">>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) {
      sets.push(`${k} = ?`);
      values.push(v);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(id);
  await db
    .prepare(`UPDATE credentials SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function deleteCredential(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM credentials WHERE id = ?").bind(id).run();
}

// ============================================================================
// Limits
// ============================================================================

export async function getLimits(db: D1Database, userId: string): Promise<UserLimits[]> {
  const result = await db
    .prepare("SELECT * FROM user_limits WHERE user_id = ?")
    .bind(userId)
    .all<UserLimits>();
  return result.results;
}

export async function upsertLimits(
  db: D1Database,
  userId: string,
  provider: string,
  rateLimit: number,
  bandwidthLimit: number | null,
  concurrency: number,
): Promise<void> {
  const existing = await db
    .prepare("SELECT id FROM user_limits WHERE user_id = ? AND provider = ?")
    .bind(userId, provider)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare(
        `UPDATE user_limits SET rate_limit=?, bandwidth_limit=?, concurrency=?, updated_at=datetime('now') WHERE id=?`,
      )
      .bind(rateLimit, bandwidthLimit, concurrency, existing.id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO user_limits (id, user_id, provider, rate_limit, bandwidth_limit, concurrency) VALUES (?,?,?,?,?,?)`,
      )
      .bind(uuid(), userId, provider, rateLimit, bandwidthLimit, concurrency)
      .run();
  }
}

// ============================================================================
// Usage
// ============================================================================

export async function logUsage(
  db: D1Database,
  userId: string,
  provider: string,
  path: string,
  method: string,
  status: number,
  bytesIn: number,
  bytesOut: number,
  durationMs: number,
  clientIp: string | null,
): Promise<void> {
  await db
    .prepare(`
    INSERT INTO usage_logs (id, user_id, provider, path, method, status, bytes_in, bytes_out, duration_ms, client_ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(uuid(), userId, provider, path, method, status, bytesIn, bytesOut, durationMs, clientIp)
    .run();
}

export async function getDailyUsage(
  db: D1Database,
  userId: string,
  days = 30,
): Promise<DailyUsage[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split("T")[0];
  const result = await db
    .prepare("SELECT * FROM daily_usage WHERE user_id = ? AND date >= ? ORDER BY date DESC")
    .bind(userId, sinceStr)
    .all<DailyUsage>();
  return result.results;
}

// ============================================================================
// Audit
// ============================================================================

export async function logAudit(
  db: D1Database,
  event: string,
  opts: {
    actorId?: string | null;
    actorIp?: string | null;
    actorUa?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    detail?: string | null;
  } = {},
): Promise<void> {
  await db
    .prepare(`
    INSERT INTO audit_logs (id, actor_id, actor_ip, actor_ua, event, target_type, target_id, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      uuid(),
      opts.actorId ?? null,
      opts.actorIp ?? null,
      opts.actorUa ?? null,
      event,
      opts.targetType ?? null,
      opts.targetId ?? null,
      opts.detail ?? null,
    )
    .run();
}

// ============================================================================
// Settings
// ============================================================================

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
  `)
    .bind(key, value, value)
    .run();
}

export async function getAllSettings(
  db: D1Database,
): Promise<Array<{ key: string; value: string; description: string | null }>> {
  const result = await db
    .prepare("SELECT key, value, description FROM settings")
    .all<{ key: string; value: string; description: string | null }>();
  return result.results;
}

// ============================================================================
// Audit Logs (查询)
// ============================================================================

export interface AuditLogQueryParams {
  page?: number;
  pageSize?: number;
  /** 精确匹配事件名（如 login_failed） */
  event?: string;
  /** 精确匹配操作用户 ID */
  actorId?: string;
  /** 模糊匹配事件名或中文标签 */
  eventSearch?: string;
  /** 模糊匹配操作用户名 */
  actorUsername?: string;
  /** 模糊匹配 IP */
  actorIp?: string;
}

export interface AuditLogRow {
  id: string;
  actor_id: string | null;
  actor_ip: string | null;
  actor_ua: string | null;
  event: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  created_at: string;
  /** JOIN 来的用户名（可选） */
  actor_username?: string | null;
}

export async function queryAuditLogs(
  db: D1Database,
  params: AuditLogQueryParams = {},
): Promise<{ rows: AuditLogRow[]; total: number }> {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 30));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const binds: unknown[] = [];

  // 精确匹配事件名
  if (params.event) {
    conditions.push("a.event = ?");
    binds.push(params.event);
  }
  // 精确匹配用户 ID
  if (params.actorId) {
    conditions.push("a.actor_id = ?");
    binds.push(params.actorId);
  }
  // 事件模糊搜索
  if (params.eventSearch) {
    const matchedEvents = buildEventMatchList(params.eventSearch);
    if (matchedEvents.length > 0) {
      const placeholders = matchedEvents.map(() => "?").join(",");
      conditions.push(`a.event IN (${placeholders})`);
      binds.push(...matchedEvents);
    } else {
      conditions.push("a.event LIKE ?");
      binds.push(`%${params.eventSearch}%`);
    }
  }
  // 用户名模糊匹配
  if (params.actorUsername) {
    conditions.push("u.username LIKE ?");
    binds.push(`%${params.actorUsername}%`);
  }
  // IP 模糊匹配
  if (params.actorIp) {
    conditions.push("a.actor_ip LIKE ?");
    binds.push(`%${params.actorIp}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // 总数
  const countSql = `SELECT COUNT(*) as c FROM audit_logs a LEFT JOIN users u ON a.actor_id = u.id ${where}`;
  const countStmt = db.prepare(countSql).bind(...binds);
  const totalRow = await countStmt.first<{ c: number }>();
  const total = totalRow?.c ?? 0;

  // 分页查询（LEFT JOIN users 获取用户名）
  const dataSql = `
    SELECT a.*, u.username as actor_username
    FROM audit_logs a
    LEFT JOIN users u ON a.actor_id = u.id
    ${where}
    ORDER BY a.created_at DESC
    LIMIT ? OFFSET ?
  `;
  const dataStmt = db.prepare(dataSql).bind(...binds, pageSize, offset);
  const result = await dataStmt.all<AuditLogRow>();

  return { rows: (result.results as AuditLogRow[]) || [], total };
}

/** 中文事件标签 → 英文事件名的反向查找表 */
const EVENT_LABEL_TO_NAME: Record<string, string> = {
  登录失败: "login_failed",
  登录成功: "login_success",
  无效子域: "hash_invalid",
  子域轮换: "hash_rotated",
  添加凭据: "credential_added",
  删除凭据: "credential_deleted",
  创建用户: "user_created",
  用户操作: "user_suspended",
  删除用户: "user_deleted",
  还原用户: "user_restored",
  设置变更: "settings_changed",
  密码重置: "password_reset",
  创建邀请: "invite_created",
  代理请求: "proxy_pull",
  爆破封禁: "brute_blocked",
};

/** 根据用户输入的搜索词，反查可能匹配的事件列表 */
function buildEventMatchList(input: string): string[] {
  const lower = input.toLowerCase();
  const events: string[] = [];

  // 1. 中文标签包含搜索词
  for (const [label, name] of Object.entries(EVENT_LABEL_TO_NAME)) {
    if (label.includes(input)) {
      events.push(name);
    }
  }
  // 2. 英文事件名包含搜索词
  for (const name of Object.values(EVENT_LABEL_TO_NAME)) {
    if (name.toLowerCase().includes(lower) && !events.includes(name)) {
      events.push(name);
    }
  }
  // 3. 搜索词本身可能是完整的事件名
  if (Object.values(EVENT_LABEL_TO_NAME).includes(input) && !events.includes(input)) {
    events.push(input);
  }

  return events;
}

// ============================================================================
// Invite Codes
// ============================================================================

export interface InviteCode {
  id: string;
  code: string;
  created_by: string;
  max_uses: number;
  used_count: number;
  expires_at: string;
  is_active: number;
  created_at: string;
}

export async function createInviteCode(db: D1Database, createdBy: string): Promise<InviteCode> {
  const id = crypto.randomUUID();
  const code = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  // 24 小时过期
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(`
    INSERT INTO invite_codes (id, code, created_by, max_uses, expires_at, is_active)
    VALUES (?, ?, ?, 1, ?, 1)
  `)
    .bind(id, code, createdBy, expiresAt)
    .run();
  const row = await db
    .prepare("SELECT * FROM invite_codes WHERE id = ?")
    .bind(id)
    .first<InviteCode>();
  return row!;
}

export async function validateInviteCode(db: D1Database, code: string): Promise<InviteCode | null> {
  const row = await db
    .prepare(`
    SELECT * FROM invite_codes
    WHERE code = ? AND is_active = 1 AND used_count < max_uses AND expires_at > datetime('now')
  `)
    .bind(code)
    .first<InviteCode>();
  return row ?? null;
}

export async function consumeInviteCode(db: D1Database, code: string): Promise<void> {
  await db
    .prepare(`
    UPDATE invite_codes
    SET used_count = used_count + 1,
        is_active = CASE WHEN used_count + 1 >= max_uses THEN 0 ELSE 1 END
    WHERE code = ?
  `)
    .bind(code)
    .run();
}

/**
 * 列出所有有效（未过期、未用完）的邀请码
 */
export async function listInviteCodes(db: D1Database): Promise<InviteCode[]> {
  const result = await db
    .prepare(`
    SELECT * FROM invite_codes
    WHERE is_active = 1 AND expires_at > datetime('now')
    ORDER BY created_at DESC
  `)
    .all<InviteCode>();
  return result.results;
}

/**
 * 禁用/删除邀请码（设置为无效）
 */
export async function deleteInviteCode(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE invite_codes SET is_active = 0 WHERE id = ?")
    .bind(id)
    .run();
  return (result.meta?.rows_written ?? 0) > 0;
}

export async function getUserByIdOrUsername(
  db: D1Database,
  identifier: string,
): Promise<User | null> {
  // 先按 ID 查，再按用户名查
  const byId = await db.prepare("SELECT * FROM users WHERE id = ?").bind(identifier).first<User>();
  if (byId) return byId;
  const byName = await db
    .prepare("SELECT * FROM users WHERE username = ?")
    .bind(identifier)
    .first<User>();
  return byName ?? null;
}

// ============================================================================
// v1.0: User Providers (per-user per-provider hash + PAT)
// ============================================================================

export async function getUserProviderByHash(
  db: D1Database,
  hash: string,
): Promise<UserProvider | null> {
  const row = await db
    .prepare("SELECT * FROM user_providers WHERE hash = ?")
    .bind(hash)
    .first<UserProvider>();
  return row ?? null;
}

export async function getUserProviders(db: D1Database, userId: string): Promise<UserProvider[]> {
  const result = await db
    .prepare("SELECT * FROM user_providers WHERE user_id = ?")
    .bind(userId)
    .all<UserProvider>();
  return result.results;
}

/** 按 user_id + provider 查询单个 user_provider 记录（用于获取用户的 PAT） */
export async function getUserProviderByUserAndProvider(
  db: D1Database,
  userId: string,
  provider: string,
): Promise<UserProvider | null> {
  const row = await db
    .prepare("SELECT * FROM user_providers WHERE user_id = ? AND provider = ? AND enabled = 1")
    .bind(userId, provider)
    .first<UserProvider>();
  return row ?? null;
}

export async function getProviderSetting(
  db: D1Database,
  provider: string,
): Promise<ProviderSetting | null> {
  const row = await db
    .prepare("SELECT * FROM provider_settings WHERE provider = ?")
    .bind(provider)
    .first<ProviderSetting>();
  return row ?? null;
}

export async function getAllProviderSettings(db: D1Database): Promise<ProviderSetting[]> {
  const result = await db.prepare("SELECT * FROM provider_settings").all<ProviderSetting>();
  return result.results;
}

export async function createUserProvider(
  db: D1Database,
  userId: string,
  provider: string,
): Promise<UserProvider> {
  const id = uuid();
  const hash = await generateUniqueHash(db);
  await db
    .prepare("INSERT INTO user_providers (id, user_id, provider, hash) VALUES (?, ?, ?, ?)")
    .bind(id, userId, provider, hash)
    .run();
  return (await db
    .prepare("SELECT * FROM user_providers WHERE id = ?")
    .bind(id)
    .first<UserProvider>())!;
}

export async function enableUserProvider(
  db: D1Database,
  userId: string,
  provider: string,
): Promise<void> {
  // 如不存在则自动创建
  const existing = await db
    .prepare("SELECT id FROM user_providers WHERE user_id = ? AND provider = ?")
    .bind(userId, provider)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare("UPDATE user_providers SET enabled = 1, updated_at = datetime('now') WHERE id = ?")
      .bind(existing.id)
      .run();
  } else {
    await createUserProvider(db, userId, provider);
  }
}

export async function disableUserProvider(
  db: D1Database,
  userId: string,
  provider: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE user_providers SET enabled = 0, updated_at = datetime('now') WHERE user_id = ? AND provider = ?",
    )
    .bind(userId, provider)
    .run();
}

export async function updateUserProviderPat(
  db: D1Database,
  userId: string,
  provider: string,
  encryptedPat: string | null,
  patUsername: string | null,
): Promise<void> {
  // 如不存在则自动创建
  const existing = await db
    .prepare("SELECT id FROM user_providers WHERE user_id = ? AND provider = ?")
    .bind(userId, provider)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare(
        "UPDATE user_providers SET pat = ?, pat_username = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .bind(encryptedPat, patUsername, existing.id)
      .run();
  } else {
    const id = uuid();
    const hash = await generateUniqueHash(db);
    await db
      .prepare(
        "INSERT INTO user_providers (id, user_id, provider, hash, pat, pat_username) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(id, userId, provider, hash, encryptedPat, patUsername)
      .run();
  }
}

export async function rotateUserProviderHash(
  db: D1Database,
  userId: string,
  provider: string,
): Promise<string> {
  const newHash = await generateUniqueHash(db);
  await db
    .prepare(
      "UPDATE user_providers SET hash = ?, updated_at = datetime('now') WHERE user_id = ? AND provider = ?",
    )
    .bind(newHash, userId, provider)
    .run();
  return newHash;
}

export async function upsertProviderSetting(
  db: D1Database,
  provider: string,
  enabled: number,
  fallbackPat?: string | null,
  rateLimit?: number | null,
): Promise<void> {
  const existing = await db
    .prepare("SELECT provider FROM provider_settings WHERE provider = ?")
    .bind(provider)
    .first();
  if (existing) {
    await db
      .prepare(
        `UPDATE provider_settings SET enabled=?, fallback_pat=?, rate_limit=?, updated_at=datetime('now') WHERE provider=?`,
      )
      .bind(enabled, fallbackPat ?? null, rateLimit ?? null, provider)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO provider_settings (provider, enabled, fallback_pat, rate_limit) VALUES (?,?,?,?)`,
      )
      .bind(provider, enabled, fallbackPat ?? null, rateLimit ?? null)
      .run();
  }
}

// ============================================================================
// v1.0: Sessions & Token Version
// ============================================================================

export async function createSession(
  db: D1Database,
  userId: string,
  tokenVersion: number,
  clientIp: string | null,
  clientUa: string | null,
): Promise<void> {
  // 标记旧会话为非当前
  await db
    .prepare("UPDATE sessions SET is_current = 0 WHERE user_id = ? AND is_current = 1")
    .bind(userId)
    .run();
  // 创建新会话
  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, token_version, client_ip, client_ua, is_current) VALUES (?, ?, ?, ?, ?, 1)",
    )
    .bind(uuid(), userId, tokenVersion, clientIp, clientUa)
    .run();
}

export async function getSessions(
  db: D1Database,
  userId: string,
): Promise<
  Array<{
    id: string;
    client_ip: string | null;
    client_ua: string | null;
    is_current: number;
    created_at: string;
  }>
> {
  const result = await db
    .prepare(
      "SELECT id, client_ip, client_ua, is_current, created_at FROM sessions WHERE user_id = ? AND token_version = (SELECT token_version FROM users WHERE id = ?) ORDER BY is_current DESC, created_at DESC",
    )
    .bind(userId, userId)
    .all<{
      id: string;
      client_ip: string | null;
      client_ua: string | null;
      is_current: number;
      created_at: string;
    }>();
  return result.results;
}

export async function incrementTokenVersion(db: D1Database, userId: string): Promise<number> {
  await db
    .prepare(
      "UPDATE users SET token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(userId)
    .run();
  const row = await db
    .prepare("SELECT token_version FROM users WHERE id = ?")
    .bind(userId)
    .first<{ token_version: number }>();
  return row?.token_version ?? 0;
}

export async function pruneOldSessions(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(
      "DELETE FROM sessions WHERE user_id = ? AND token_version < (SELECT token_version FROM users WHERE id = ?)",
    )
    .bind(userId, userId)
    .run();
}
