// ============================================================================
// src/worker/api/auth.ts — /api/v1/auth/* (登录/注册/密码/hash 轮换)
// ============================================================================

import type { Env } from "../providers/types";
import { makeRes } from "../config";
import { hashPassword, verifyPassword, validatePassword } from "../crypto";
import { sign as signJwt } from "../jwt";
import {
  getUserByUsername,
  createUser,
  updateUser,
  logAudit,
  getSetting,
  setSetting,
  validateInviteCode,
  consumeInviteCode,
  rotateUserProviderHash,
  createSession,
  getSessions,
  incrementTokenVersion,
  pruneOldSessions,
} from "../db";
import { authenticateWeb } from "../auth";
import { checkLoginBruteForce, recordLoginFailed, clearLoginAttempts } from "../rate-limit";
import { getRuntimeConfig, invalidateRuntimeConfig } from "../settings-cache";

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

/** 将 IP 写入黑名单设置 */
async function blacklistIP(env: Env, ip: string): Promise<void> {
  const current = await getSetting(env.DB, "ip_blacklist");
  const list = current
    ? current
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (!list.includes(ip)) {
    list.push(ip);
    await setSetting(env.DB, "ip_blacklist", list.join(","));
    invalidateRuntimeConfig();
  }
}

interface AuthHandlers {
  login(request: Request, env: Env): Promise<Response>;
  register(request: Request, env: Env): Promise<Response>;
  me(request: Request, env: Env): Promise<Response>;
  changePassword(request: Request, env: Env): Promise<Response>;
  updateProfile(request: Request, env: Env): Promise<Response>;
  deactivate(request: Request, env: Env): Promise<Response>;
  rotateHash(request: Request, env: Env): Promise<Response>;
  setupStatus(request: Request, env: Env): Promise<Response>;
  setup(request: Request, env: Env): Promise<Response>;
  sessions(request: Request, env: Env): Promise<Response>;
  revoke(request: Request, env: Env): Promise<Response>;
}

export const authHandlers: AuthHandlers = {
  // POST /api/v1/auth/login
  async login(request, env) {
    let body: { username?: string; password?: string };
    try {
      body = (await request.json()) as Record<string, string>;
    } catch {
      return makeRes(JSON.stringify({ error: "invalid json" }), 400);
    }
    if (!body.username || !body.password)
      return makeRes(JSON.stringify({ error: "username and password required" }), 400);

    const clientIp = getIP(request);
    const ua = request.headers.get("User-Agent") || "";

    // ---- 爆破检查 ----
    const rtConfig = await getRuntimeConfig(env);
    const bruteBlocked = checkLoginBruteForce(clientIp, body.username);
    if (bruteBlocked) return bruteBlocked;

    const user = await getUserByUsername(env.DB, body.username);
    if (!user || user.status !== "active") {
      const banned = recordLoginFailed(clientIp, body.username, rtConfig.bruteLimitAttempts);
      if (banned) {
        await blacklistIP(env, banned);
        await logAudit(env.DB, "brute_blocked", {
          actorIp: clientIp,
          actorUa: ua,
          detail: JSON.stringify({ username: body.username, reason: "login_user_not_found" }),
        });
      }
      await logAudit(env.DB, "login_failed", {
        actorIp: clientIp,
        actorUa: ua,
        detail: JSON.stringify({ username: body.username, reason: "user_not_found_or_inactive" }),
      });
      return makeRes(JSON.stringify({ error: "invalid credentials" }), 401);
    }

    const valid = await verifyPassword(body.password, user.password);
    if (!valid) {
      const banned = recordLoginFailed(clientIp, body.username, rtConfig.bruteLimitAttempts);
      if (banned) {
        await blacklistIP(env, banned);
        await logAudit(env.DB, "brute_blocked", {
          actorId: user.id,
          actorIp: clientIp,
          actorUa: ua,
          detail: JSON.stringify({ username: body.username, reason: "login_wrong_password" }),
        });
      }
      await logAudit(env.DB, "login_failed", { actorId: user.id, actorIp: clientIp, actorUa: ua });
      return makeRes(JSON.stringify({ error: "invalid credentials" }), 401);
    }

    // 登录成功 → 清除失败记录
    clearLoginAttempts(clientIp, body.username);
    await logAudit(env.DB, "login_success", { actorId: user.id, actorIp: clientIp, actorUa: ua });

    const token = await signJwt({ sub: user.id, role: user.role }, env.JWT_SECRET, 604800, user.token_version ?? 0);
    await createSession(env.DB, user.id, user.token_version ?? 0, clientIp, ua);
    return makeRes(
      JSON.stringify({
        token,
        user: { id: user.id, username: user.username, role: user.role },
      }),
    );
  },

  // POST /api/v1/auth/register
  async register(request, env) {
    const mode = (await getSetting(env.DB, "registration_mode")) || "invite";
    if (mode === "closed") return makeRes(JSON.stringify({ error: "registration is closed" }), 403);

    let body: { username?: string; password?: string; email?: string; invite_code?: string };
    try {
      body = (await request.json()) as Record<string, string>;
    } catch {
      return makeRes(JSON.stringify({ error: "invalid json" }), 400);
    }
    if (!body.username || !body.password)
      return makeRes(JSON.stringify({ error: "username and password required" }), 400);
    if (body.username.length < 3 || body.username.length > 32)
      return makeRes(JSON.stringify({ error: "username must be 3-32 characters" }), 400);

    // 密码强度校验（从 settings 读取策略）
    const rtConfig = await getRuntimeConfig(env);
    const pwErr = validatePassword(body.password, {
      minLength: rtConfig.pwdMinLength,
      requireNumber: rtConfig.pwdRequireNumber,
      requireSymbol: rtConfig.pwdRequireSymbol,
    });
    if (pwErr) return makeRes(JSON.stringify({ error: pwErr }), 400);

    // Invite mode: validate invite code
    if (mode !== "open") {
      if (!body.invite_code) return makeRes(JSON.stringify({ error: "invite code required" }), 400);
      const invite = await validateInviteCode(env.DB, body.invite_code);
      if (!invite) return makeRes(JSON.stringify({ error: "invalid or expired invite code" }), 403);
    }

    const existing = await getUserByUsername(env.DB, body.username);
    if (existing) return makeRes(JSON.stringify({ error: "username already taken" }), 409);

    // Validate email
    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return makeRes(JSON.stringify({ error: "invalid email format" }), 400);
    }

    const pwHash = await hashPassword(body.password);
    const user = await createUser(env.DB, body.username, pwHash, "user", body.email);

    // Consume invite code
    if (mode !== "open" && body.invite_code) {
      await consumeInviteCode(env.DB, body.invite_code);
    }

    const clientIp = getIP(request);
    const ua = getUA(request);
    await logAudit(env.DB, "login_success", {
      actorId: user.id,
      actorIp: clientIp,
      actorUa: ua,
      detail: "register",
    });

    const token = await signJwt({ sub: user.id, role: user.role }, env.JWT_SECRET, 604800, user.token_version ?? 0);
    await createSession(env.DB, user.id, user.token_version ?? 0, clientIp, ua);
    return makeRes(
      JSON.stringify({
        token,
        user: { id: user.id, username: user.username, role: user.role },
      }),
    );
  },

  // GET /api/v1/auth/me
  async me(request, env) {
    const user = await authenticateWeb(request, env);
    if (!user) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
    return makeRes(
      JSON.stringify({
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status,
        email: user.email ?? null,
        created_at: user.created_at,
      }),
    );
  },

  // PUT /api/v1/auth/password
  async changePassword(request, env) {
    const user = await authenticateWeb(request, env);
    if (!user) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);

    let body: { newPassword?: string };
    try {
      body = (await request.json()) as Record<string, string>;
    } catch {
      return makeRes(JSON.stringify({ error: "invalid json" }), 400);
    }
    if (!body.newPassword) return makeRes(JSON.stringify({ error: "newPassword required" }), 400);

    // 密码强度校验
    const rtConfig2 = await getRuntimeConfig(env);
    const pwErr2 = validatePassword(body.newPassword, {
      minLength: rtConfig2.pwdMinLength,
      requireNumber: rtConfig2.pwdRequireNumber,
      requireSymbol: rtConfig2.pwdRequireSymbol,
    });
    if (pwErr2) return makeRes(JSON.stringify({ error: pwErr2 }), 400);

    const pwHash = await hashPassword(body.newPassword);
    await updateUser(env.DB, user.id, { password: pwHash });

    const clientIp = getIP(request);
    const ua1 = getUA(request);
    await logAudit(env.DB, "settings_changed", {
      actorId: user.id,
      actorIp: clientIp,
      actorUa: ua1,
      detail: "password_changed",
    });

    return makeRes(JSON.stringify({ success: true }));
  },

  // PUT /api/v1/auth/profile
  async updateProfile(request, env) {
    const user = await authenticateWeb(request, env);
    if (!user) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);

    let body: { username?: string; email?: string };
    try {
      body = (await request.json()) as Record<string, string>;
    } catch {
      return makeRes(JSON.stringify({ error: "invalid json" }), 400);
    }

    if (body.username !== undefined) {
      if (body.username.length < 3 || body.username.length > 32)
        return makeRes(JSON.stringify({ error: "username must be 3-32 characters" }), 400);
      const existing = await getUserByUsername(env.DB, body.username);
      if (existing && existing.id !== user.id)
        return makeRes(JSON.stringify({ error: "username already taken" }), 409);
    }
    if (
      body.email !== undefined &&
      body.email !== "" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)
    ) {
      return makeRes(JSON.stringify({ error: "invalid email format" }), 400);
    }

    const fields: Record<string, string | null> = {};
    if (body.username !== undefined) fields.username = body.username;
    if (body.email !== undefined) fields.email = body.email || null;
    if (Object.keys(fields).length === 0)
      return makeRes(JSON.stringify({ error: "nothing to update" }), 400);

    await updateUser(env.DB, user.id, fields);

    const clientIp2 = getIP(request);
    const ua2 = getUA(request);
    await logAudit(env.DB, "settings_changed", {
      actorId: user.id,
      actorIp: clientIp2,
      actorUa: ua2,
      detail: `profile_updated:${JSON.stringify(fields)}`,
    });

    return makeRes(
      JSON.stringify({
        success: true,
        username: body.username ?? user.username,
        email: body.email !== undefined ? body.email || null : user.email,
      }),
    );
  },

  // POST /api/v1/auth/deactivate — 用户主动停用账号
  async deactivate(request, env) {
    const user = await authenticateWeb(request, env);
    if (!user) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);

    await updateUser(env.DB, user.id, { status: "deleted", deleted_at: new Date().toISOString() });

    const clientIp3 = getIP(request);
    const ua3 = getUA(request);
    await logAudit(env.DB, "settings_changed", {
      actorId: user.id,
      actorIp: clientIp3,
      actorUa: ua3,
      detail: "self_deactivated",
    });

    return makeRes(JSON.stringify({ success: true }));
  },

  // POST /api/v1/auth/rotate-hash — v1.0: 轮换所有 user_providers hash
  async rotateHash(request, env) {
    const user = await authenticateWeb(request, env);
    if (!user) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);

    const providers = await env.DB.prepare(
      "SELECT id, provider, hash FROM user_providers WHERE user_id = ?"
    ).bind(user.id).all<{ id: string; provider: string; hash: string }>();

    const rotated: Record<string, string> = {};
    for (const up of providers.results) {
      const oldHash = up.hash;
      const newHash = await rotateUserProviderHash(env.DB, user.id, up.provider);
      rotated[oldHash] = newHash;
    }

    const clientIp4 = getIP(request);
    const ua4 = getUA(request);
    await logAudit(env.DB, "hash_rotated", {
      actorId: user.id,
      actorIp: clientIp4,
      actorUa: ua4,
      detail: JSON.stringify({ count: providers.results.length }),
    });

    return makeRes(JSON.stringify({ rotated }));
  },

  // GET /api/v1/auth/setup-status — 检查是否需要初始化管理员
  async setupStatus(_request, env) {
    if (!env.DB) return makeRes(JSON.stringify({ needsSetup: false }), 200);
    const row = await env.DB.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").first<{
      c: number;
    }>();
    return makeRes(JSON.stringify({ needsSetup: (row?.c ?? 0) === 0 }));
  },

  // POST /api/v1/auth/setup — 初始化第一个管理员
  async setup(request, env) {
    if (!env.DB) return makeRes(JSON.stringify({ error: "database unavailable" }), 503);

    const row = await env.DB.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").first<{
      c: number;
    }>();
    if ((row?.c ?? 0) > 0) {
      return makeRes(JSON.stringify({ error: "setup already completed" }), 403);
    }

    let body: { username?: string; password?: string; email?: string };
    try {
      body = (await request.json()) as Record<string, string>;
    } catch {
      return makeRes(JSON.stringify({ error: "invalid json" }), 400);
    }

    if (!body.username || !body.password)
      return makeRes(JSON.stringify({ error: "username and password required" }), 400);
    if (body.username.length < 3 || body.username.length > 32)
      return makeRes(JSON.stringify({ error: "username must be 3-32 characters" }), 400);
    if (body.password.length < 8)
      return makeRes(JSON.stringify({ error: "password must be at least 8 characters" }), 400);

    const pwHash = await hashPassword(body.password);
    const user = await createUser(env.DB, body.username, pwHash, "admin", body.email);

    const token = await signJwt({ sub: user.id, role: user.role }, env.JWT_SECRET, 604800, user.token_version ?? 0);
    await createSession(env.DB, user.id, user.token_version ?? 0, getIP(request), getUA(request));
    return makeRes(
      JSON.stringify({
        token,
        user: { id: user.id, username: user.username, role: user.role },
      }),
    );
  },

  // GET /api/v1/auth/sessions — 查看当前有效会话
  async sessions(request, env) {
    const user = await authenticateWeb(request, env);
    if (!user) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);
    await pruneOldSessions(env.DB, user.id);
    const sessions = await getSessions(env.DB, user.id);
    return makeRes(JSON.stringify({ success: true, data: sessions }));
  },

  // POST /api/v1/auth/sessions/revoke — 递增 token_version 使所有会话失效并签发新 token
  async revoke(request, env) {
    const user = await authenticateWeb(request, env);
    if (!user) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);

    const newVersion = await incrementTokenVersion(env.DB, user.id);
    const token = await signJwt({ sub: user.id, role: user.role }, env.JWT_SECRET, 604800, newVersion);

    const clientIp = getIP(request);
    const ua = getUA(request);
    await createSession(env.DB, user.id, newVersion, clientIp, ua);

    return makeRes(JSON.stringify({ success: true, token }));
  },
};

/** 路由分发：/api/v1/auth/{action} */
export async function handleAuthRoute(
  request: Request,
  env: Env,
  action: string,
): Promise<Response> {
  switch (action) {
    case "login":
      return authHandlers.login(request, env);
    case "register":
      return authHandlers.register(request, env);
    case "me":
      return authHandlers.me(request, env);
    case "password":
      return authHandlers.changePassword(request, env);
    case "profile":
      return authHandlers.updateProfile(request, env);
    case "deactivate":
      return authHandlers.deactivate(request, env);
    case "rotate-hash":
      return authHandlers.rotateHash(request, env);
    case "setup-status":
      return authHandlers.setupStatus(request, env);
    case "setup":
      return authHandlers.setup(request, env);
    case "sessions/revoke":
      return authHandlers.revoke(request, env);
    case "sessions":
      return authHandlers.sessions(request, env);
    default:
      return makeRes(JSON.stringify({ error: "not found" }), 404);
  }
}
