// ============================================================================
// src/worker/auth.ts — v1.0 鉴权双通道 (CLI hash + Web JWT)
// ============================================================================

import type { Env } from "./providers/types";
import type { User, AuthContext } from "../shared/types";
import { verify as verifyJwt } from "./jwt";
import { getUserProviderByHash, getCredentials, getUserById } from "./db";
import { getCachedAuth, setCachedAuth } from "./cache";

// ============================================================================
// CLI Auth: hash 子域名 → D1/Cache 查 user_providers
// ============================================================================

export async function authenticateCli(
  hash: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<AuthContext | null> {
  // 1. 尝试 Cache API
  const cached = await getCachedAuth(hash);
  if (cached) {
    return { user: cached.user, credential: cached.credential };
  }

  // 2. Cache miss → D1
  if (!env.DB) {
    console.error("[auth] D1 binding missing");
    return null;
  }

  const up = await getUserProviderByHash(env.DB, hash);
  if (!up) return null;

  const user = await getUserById(env.DB, up.user_id);
  if (!user || user.status !== "active") return null;

  // 3. 查该 provider 的凭据 → 随机轮询（多凭据时负载均衡）
  const creds = await getCredentials(env.DB, user.id, up.provider);
  const activeCreds = creds.filter((c) => c.is_active === 1);
  const selectedCred =
    activeCreds.length > 0
      ? activeCreds[Math.floor(Math.random() * activeCreds.length)]
      : undefined;

  const result = { user, credential: selectedCred };

  // 4. 写入 Cache (异步)
  setCachedAuth(ctx, hash, result);

  return result;
}

// ============================================================================
// Web Auth: JWT Bearer Token
// ============================================================================

export async function authenticateWeb(request: Request, env: Env): Promise<User | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) return null;

  // JWT 有效，查 D1 获取完整用户信息
  if (!env.DB) return null;
  const user = await getUserById(env.DB, payload.sub);
  if (!user || user.status !== "active") return null;

  // v1.0: 校验 token_version，已被吊销的旧 token 拒绝
  if (payload.ver !== undefined && payload.ver < (user.token_version ?? 0)) return null;

  return user;
}

// ============================================================================
// Role Guard
// ============================================================================

export function requireRole(user: User, ...roles: string[]): void {
  if (!roles.includes(user.role)) {
    throw new Error(`Forbidden: requires role ${roles.join(" or ")}`);
  }
}
