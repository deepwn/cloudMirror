// ============================================================================
// src/worker/api/admin.ts — /api/v1/admin/* 管理面板 API
// ============================================================================

import type { Env } from "../providers/types";
import { makeRes } from "../config";
import { authenticateWeb, requireRole } from "../auth";
import {
  listUsers,
  getUserById,
  updateUser,
  softDeleteUser,
  restoreUser,
  getCredentials,
  getAllSettings,
  setSetting,
  createInviteCode,
  listInviteCodes,
  deleteInviteCode,
  logAudit,
  queryAuditLogs,
} from "../db";
import { hashPassword, generateCompliantPassword } from "../crypto";
import type { UserRole } from "@shared/types";
import { invalidateRuntimeConfig, getRuntimeConfig } from "../settings-cache";

/** 从请求头提取客户端 IP */
function getIP(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    request.headers.get("X-Real-IP") ??
    "unknown"
  );
}

/** 从请求头提取 UA */
function getUA(request: Request): string {
  return request.headers.get("User-Agent") || "";
}

/**
 * 用户列表。
 * GET /api/v1/admin/users?page=1&search=
 */
async function getUsers(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateWeb(request, env);
  if (!admin) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
  try {
    requireRole(admin, "admin");
  } catch {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50),
  );
  const search = url.searchParams.get("search") || undefined;

  const { users, total } = await listUsers(env.DB, page, pageSize, search);

  return makeRes(
    JSON.stringify({
      success: true,
      data: {
        users: users.map((u) => ({
          id: u.id,
          username: u.username,
          role: u.role,
          status: u.status,
          email: u.email,
          note: u.note,
          deleted_at: u.deleted_at,
          created_at: u.created_at,
        })),
        page,
        pageSize,
        total,
      },
    }),
  );
}

/**
 * 获取单个用户详情（含凭据列表）。
 * GET /api/v1/admin/users/:id
 */
async function getUserDetail(request: Request, env: Env, userId: string): Promise<Response> {
  const admin = await authenticateWeb(request, env);
  if (!admin) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
  try {
    requireRole(admin, "admin");
  } catch {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  const user = await getUserById(env.DB, userId);
  if (!user) return makeRes(JSON.stringify({ error: "user not found" }), 404);

  const creds = await getCredentials(env.DB, userId).catch(() => []);

  return makeRes(
    JSON.stringify({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status,
        email: user.email,
        note: user.note,
        created_at: user.created_at,
        updated_at: user.updated_at,
        credentials: creds.map((c) => ({
          id: c.id,
          provider: c.provider,
          label: c.label,
          username: c.username,
          is_active: c.is_active === 1,
          created_at: c.created_at,
        })),
      },
    }),
  );
}

/**
 * 更新用户状态/角色/备注（不能修改密码）。
 * PUT /api/v1/admin/users/:id
 * Body: { status?, role?, note? }
 */
async function updateUserHandler(request: Request, env: Env, userId: string): Promise<Response> {
  const admin = await authenticateWeb(request, env);
  if (!admin) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
  try {
    requireRole(admin, "admin");
  } catch {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  const existing = await getUserById(env.DB, userId);
  if (!existing) return makeRes(JSON.stringify({ error: "user not found" }), 404);

  let body: { status?: string; role?: string; note?: string };
  try {
    body = (await request.json()) as Record<string, string>;
  } catch {
    return makeRes(JSON.stringify({ error: "invalid json" }), 400);
  }

  const fields: Record<string, unknown> = {};
  if (body.status && ["active", "suspended", "deleted"].includes(body.status)) {
    fields.status = body.status;
  }
  if (body.role && ["user", "admin"].includes(body.role)) {
    fields.role = body.role as UserRole;
    // 不能把自己降级为非 admin
    if (userId === admin.id && body.role !== "admin") {
      return makeRes(JSON.stringify({ error: "cannot demote yourself" }), 400);
    }
  }
  if (body.note !== undefined) {
    fields.note = body.note;
  }

  if (Object.keys(fields).length === 0) {
    return makeRes(JSON.stringify({ error: "no valid fields to update" }), 400);
  }

  await updateUser(env.DB, userId, fields as Parameters<typeof updateUser>[2]);

  await logAudit(env.DB, "user_suspended", {
    actorId: admin.id,
    actorIp: getIP(request),
    actorUa: getUA(request),
    targetType: "user",
    targetId: userId,
    detail: JSON.stringify(fields),
  });

  return makeRes(JSON.stringify({ success: true }));
}

/**
 * 软删除用户（设置 status='deleted'，72h 内可还原）。
 * DELETE /api/v1/admin/users/:id
 */
async function deleteUserHandler(request: Request, env: Env, userId: string): Promise<Response> {
  const adminUser = await authenticateWeb(request, env);
  if (!adminUser) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
  try {
    requireRole(adminUser, "admin");
  } catch {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  if (userId === adminUser.id) {
    return makeRes(JSON.stringify({ error: "cannot delete yourself" }), 400);
  }

  const existing = await getUserById(env.DB, userId);
  if (!existing) return makeRes(JSON.stringify({ error: "user not found" }), 404);

  await softDeleteUser(env.DB, userId);

  await logAudit(env.DB, "user_deleted", {
    actorId: adminUser.id,
    actorIp: getIP(request),
    actorUa: getUA(request),
    targetType: "user",
    targetId: userId,
    detail: JSON.stringify({ method: "soft", retention: "72h" }),
  });

  return makeRes(JSON.stringify({ success: true, message: "用户已停用，72 小时内可还原" }));
}

/**
 * 还原被软删除的用户。
 * POST /api/v1/admin/users/:id/restore
 */
async function restoreUserHandler(request: Request, env: Env, userId: string): Promise<Response> {
  const adminUser = await authenticateWeb(request, env);
  if (!adminUser) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
  try {
    requireRole(adminUser, "admin");
  } catch {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  const existing = await getUserById(env.DB, userId);
  if (!existing) return makeRes(JSON.stringify({ error: "user not found" }), 404);
  if (existing.status !== "deleted") {
    return makeRes(JSON.stringify({ error: "user is not in deleted state" }), 400);
  }

  await restoreUser(env.DB, userId);

  await logAudit(env.DB, "user_restored", {
    actorId: adminUser.id,
    actorIp: getIP(request),
    actorUa: getUA(request),
    targetType: "user",
    targetId: userId,
  });

  return makeRes(JSON.stringify({ success: true, message: "用户已还原" }));
}

/**
 * 获取系统设置。
 * GET /api/v1/admin/settings
 */
async function getSettings(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateWeb(request, env);
  if (!admin) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
  try {
    requireRole(admin, "admin");
  } catch {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  const settings = await getAllSettings(env.DB);

  return makeRes(JSON.stringify({ success: true, data: settings }));
}

/**
 * 更新系统设置。
 * PUT /api/v1/admin/settings
 * Body: { key: string; value: string }[]
 */
async function updateSettings(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateWeb(request, env);
  if (!admin) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
  try {
    requireRole(admin, "admin");
  } catch {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  let body: Array<{ key: string; value: string }>;
  try {
    body = (await request.json()) as Array<{ key: string; value: string }>;
  } catch {
    return makeRes(JSON.stringify({ error: "invalid json, expected array of {key,value}" }), 400);
  }

  for (const { key, value } of body) {
    if (!key) continue;
    await setSetting(env.DB, key, value);
  }

  // 主动失效 runtime 配置缓存
  invalidateRuntimeConfig();

  await logAudit(env.DB, "settings_changed", {
    actorId: admin.id,
    actorIp: getIP(request),
    actorUa: getUA(request),
    detail: JSON.stringify(body.map((s) => s.key)),
  });

  return makeRes(JSON.stringify({ success: true }));
}

/**
 * 全局统计概览。
 * GET /api/v1/admin/stats
 */
async function getStats(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateWeb(request, env);
  if (!admin) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
  try {
    requireRole(admin, "admin");
  } catch {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  const [userCount, todayRequests, totalCredentials] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as c FROM users")
      .first<{ c: number }>()
      .then((r) => r?.c ?? 0),
    env.DB.prepare(
      "SELECT COUNT(*) as c FROM audit_logs WHERE event = 'proxy_pull' AND created_at >= datetime('now', 'start of day')",
    )
      .first<{ c: number }>()
      .then((r) => r?.c ?? 0),
    env.DB.prepare("SELECT COUNT(*) as c FROM credentials")
      .first<{ c: number }>()
      .then((r) => r?.c ?? 0),
  ]);

  return makeRes(
    JSON.stringify({
      success: true,
      data: {
        totalUsers: userCount,
        todayRequests,
        totalCredentials,
        activeProviders: 8,
      },
    }),
  );
}

// ============================================================================
// Invite Code
// ============================================================================

/**
 * 创建邀请码。
 * POST /api/v1/admin/invite
 */
async function createInviteHandler(request: Request, env: Env): Promise<Response> {
  const adminUser = await authenticateWeb(request, env);
  if (!adminUser) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
  try {
    requireRole(adminUser, "admin");
  } catch {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  const invite = await createInviteCode(env.DB, adminUser.id);

  await logAudit(env.DB, "invite_created", {
    actorId: adminUser.id,
    actorIp: getIP(request),
    actorUa: getUA(request),
    detail: JSON.stringify({ code: invite.code }),
  });

  const origin = new URL(request.url).origin;
  const link = `${origin}/register?invite=${invite.code}`;

  return makeRes(
    JSON.stringify({
      success: true,
      data: { code: invite.code, link, expires_at: invite.expires_at },
    }),
  );
}

/**
 * 列出当前有效的邀请码。
 * GET /api/v1/admin/invite
 */
async function listInvitesHandler(request: Request, env: Env): Promise<Response> {
  const adminUser = await authenticateWeb(request, env);
  if (!adminUser) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
  try {
    requireRole(adminUser, "admin");
  } catch {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  const invites = await listInviteCodes(env.DB);
  const origin = new URL(request.url).origin;

  return makeRes(
    JSON.stringify({
      success: true,
      data: invites.map((i) => ({
        id: i.id,
        code: i.code,
        link: `${origin}/register?invite=${i.code}`,
        used_count: i.used_count,
        max_uses: i.max_uses,
        expires_at: i.expires_at,
        created_at: i.created_at,
      })),
    }),
  );
}

/**
 * 删除/禁用邀请码。
 * DELETE /api/v1/admin/invite/:id
 */
async function deleteInviteHandler(request: Request, env: Env, id: string): Promise<Response> {
  const adminUser = await authenticateWeb(request, env);
  if (!adminUser) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
  try {
    requireRole(adminUser, "admin");
  } catch {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  await deleteInviteCode(env.DB, id);

  await logAudit(env.DB, "settings_changed", {
    actorId: adminUser.id,
    actorIp: getIP(request),
    actorUa: getUA(request),
    targetType: "invite",
    targetId: id,
    detail: "deleted",
  });

  return makeRes(JSON.stringify({ success: true }));
}

// ============================================================================
// Reset Password
// ============================================================================

/**
 * 强制重置用户密码（管理员操作）。
 * POST /api/v1/admin/users/:id/reset-password
 */
async function resetUserPassword(request: Request, env: Env, userId: string): Promise<Response> {
  const adminUser = await authenticateWeb(request, env);
  if (!adminUser) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
  try {
    requireRole(adminUser, "admin");
  } catch {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  if (userId === adminUser.id) {
    return makeRes(
      JSON.stringify({ error: "cannot reset your own password via admin panel" }),
      400,
    );
  }

  const existing = await getUserById(env.DB, userId);
  if (!existing) return makeRes(JSON.stringify({ error: "user not found" }), 404);

  // 生成随机强密码（满足密码策略）
  const rtConfig = await getRuntimeConfig(env);
  const newPassword = generateCompliantPassword({
    minLength: rtConfig.pwdMinLength,
    requireNumber: rtConfig.pwdRequireNumber,
    requireSymbol: rtConfig.pwdRequireSymbol,
  });
  const pwHash = await hashPassword(newPassword);

  await updateUser(env.DB, userId, { password: pwHash } as Parameters<typeof updateUser>[2]);

  await logAudit(env.DB, "password_reset", {
    actorId: adminUser.id,
    actorIp: getIP(request),
    actorUa: getUA(request),
    targetType: "user",
    targetId: userId,
  });

  return makeRes(
    JSON.stringify({
      success: true,
      data: { username: existing.username, password: newPassword },
    }),
  );
}

// ============================================================================
// Audit Logs
// ============================================================================

/**
 * 查询审计日志（分页，支持按 event/username/IP 模糊搜索）。
 * GET /api/v1/admin/audit-logs?page=1&pageSize=30&event=登录&username=admin&ip=1.2
 */
async function getAuditLogs(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateWeb(request, env);
  if (!admin) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
  try {
    requireRole(admin, "admin");
  } catch {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("pageSize") || "30", 10) || 30),
  );
  const eventSearch = url.searchParams.get("event") || undefined;
  const actorId = url.searchParams.get("actorId") || undefined;
  const actorUsername = url.searchParams.get("username") || undefined;
  const actorIp = url.searchParams.get("ip") || undefined;

  const { rows, total } = await queryAuditLogs(env.DB, {
    page,
    pageSize,
    event: eventSearch,
    actorId,
    actorUsername,
    actorIp,
  });

  return makeRes(
    JSON.stringify({
      success: true,
      data: {
        rows: rows.map((r) => ({
          id: r.id,
          actorId: r.actor_id,
          actorUsername: r.actor_username ?? null,
          actorIp: r.actor_ip,
          actorUa: r.actor_ua,
          event: r.event,
          targetType: r.target_type,
          targetId: r.target_id,
          detail: r.detail
            ? (() => {
                try {
                  return JSON.parse(r.detail);
                } catch {
                  return r.detail;
                }
              })()
            : null,
          createdAt: r.created_at,
        })),
        page,
        pageSize,
        total,
      },
    }),
  );
}

// ============================================================================
// Backup / Restore
// ============================================================================

interface BackupPayload {
  version: string;
  exportedAt: string;
  settings: { key: string; value: string }[];
  users: { username: string; role: string; status: string }[];
}

/**
 * 导出配置备份。
 * GET /api/v1/admin/backup
 */
async function exportBackup(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateWeb(request, env);
  if (!admin) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
  try {
    requireRole(admin, "admin");
  } catch {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  const [settings, userRows] = await Promise.all([
    env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>(),
    env.DB.prepare("SELECT username, role, status FROM users WHERE status != 'deleted'").all<{
      username: string;
      role: string;
      status: string;
    }>(),
  ]);

  const payload: BackupPayload = {
    version: "3.0.0",
    exportedAt: new Date().toISOString(),
    settings: (settings.results || []).map((r) => ({ key: r.key, value: r.value })),
    users: (userRows.results || []).map((r) => ({
      username: r.username,
      role: r.role,
      status: r.status,
    })),
  };

  return makeRes(JSON.stringify(payload), 200, {
    "Content-Type": "application/json",
    "Content-Disposition": `attachment; filename="cloudmirror-backup-${new Date().toISOString().slice(0, 10)}.json"`,
  });
}

/**
 * 导入配置备份。
 * POST /api/v1/admin/backup
 */
async function importBackup(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateWeb(request, env);
  if (!admin) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
  try {
    requireRole(admin, "admin");
  } catch {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  let payload: BackupPayload;
  try {
    payload = (await request.json()) as BackupPayload;
  } catch {
    return makeRes(JSON.stringify({ error: "invalid backup file" }), 400);
  }

  if (!payload.settings || !payload.users) {
    return makeRes(JSON.stringify({ error: "backup file missing required sections" }), 400);
  }

  try {
    // 恢复 settings
    for (const s of payload.settings) {
      if (!s.key) continue;
      await env.DB.prepare(
        "INSERT OR REPLACE INTO settings (key, value, description) VALUES (?, ?, '')",
      )
        .bind(s.key, s.value)
        .run();
    }

    // 恢复 users (仅新增已删除的)
    let restored = 0;
    for (const u of payload.users) {
      const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
        .bind(u.username)
        .first();
      if (existing) continue;
      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO users (id, username, password, role, status) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(id, u.username, "", u.role, u.status || "active")
        .run();
      restored++;
    }

    invalidateRuntimeConfig();

    await logAudit(env.DB, "settings_changed", {
      actorId: admin.id,
      actorIp: getIP(request),
      actorUa: getUA(request),
      detail: JSON.stringify({
        action: "backup_import",
        restoredUsers: restored,
        timestamp: payload.exportedAt,
      }),
    });

    return makeRes(
      JSON.stringify({
        success: true,
        message: `已恢复 ${payload.settings.length} 项设置，${restored} 个用户`,
      }),
    );
  } catch (err) {
    console.error("[backup:import]", (err as Error).message);
    return makeRes(JSON.stringify({ error: "导入失败: " + (err as Error).message }), 500);
  }
}

/**
 * Admin 路由分发。
 */
export async function handleAdminRoute(
  request: Request,
  env: Env,
  subPath: string,
): Promise<Response> {
  // /admin/users, /admin/users/:id, /admin/settings, /admin/stats
  const segments = subPath.replace(/^\//, "").split("/").filter(Boolean);

  if (segments[0] === "users") {
    const userId = segments[1] || "";
    if (userId && segments[2] === "reset-password" && request.method === "POST") {
      return resetUserPassword(request, env, userId);
    }
    if (userId && segments[2] === "restore" && request.method === "POST") {
      return restoreUserHandler(request, env, userId);
    }
    switch (request.method) {
      case "GET":
        return userId ? getUserDetail(request, env, userId) : getUsers(request, env);
      case "PUT":
        return updateUserHandler(request, env, userId);
      case "DELETE":
        return deleteUserHandler(request, env, userId);
      default:
        return makeRes(JSON.stringify({ error: "method not allowed" }), 405);
    }
  }

  if (segments[0] === "settings") {
    switch (request.method) {
      case "GET":
        return getSettings(request, env);
      case "PUT":
        return updateSettings(request, env);
      default:
        return makeRes(JSON.stringify({ error: "method not allowed" }), 405);
    }
  }

  if (segments[0] === "invite") {
    const inviteId = segments[1] || "";
    if (inviteId && request.method === "DELETE") {
      return deleteInviteHandler(request, env, inviteId);
    }
    if (request.method === "POST") return createInviteHandler(request, env);
    if (request.method === "GET") return listInvitesHandler(request, env);
    return makeRes(JSON.stringify({ error: "method not allowed" }), 405);
  }

  if (segments[0] === "stats") {
    return getStats(request, env);
  }

  if (segments[0] === "audit-logs" && request.method === "GET") {
    return getAuditLogs(request, env);
  }

  if (segments[0] === "backup") {
    if (request.method === "GET") return exportBackup(request, env);
    if (request.method === "POST") return importBackup(request, env);
    return makeRes(JSON.stringify({ error: "method not allowed" }), 405);
  }

  return makeRes(JSON.stringify({ error: "admin endpoint not found" }), 404);
}
