// ============================================================================
// src/worker/api/providers.ts — v1.0: 用户 Provider 管理 API
// ============================================================================

import type { Env } from "../providers/types";
import { makeRes } from "../config";
import { authenticateWeb } from "../auth";
import {
  getUserProviders,
  enableUserProvider,
  disableUserProvider,
  updateUserProviderPat,
  rotateUserProviderHash,
  upsertProviderSetting,
  getAllProviderSettings,
} from "../db";
import { encryptSecret } from "../crypto";

/**
 * 用户 Provider 管理:
 *   GET    /api/v1/providers              → 用户的 provider 状态列表
 *   POST   /api/v1/providers/:id/enable   → 启用
 *   POST   /api/v1/providers/:id/disable  → 禁用
 *   PUT    /api/v1/providers/:id/pat      → 设置 PAT
 *   POST   /api/v1/providers/:id/rotate   → 轮换 hash
 *
 * 管理员全局 Provider 设置:
 *   GET    /api/v1/providers/admin        → 所有 provider 全局设置
 *   PUT    /api/v1/providers/admin        → 更新全局设置
 */
export async function handleProviderRoute(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const user = await authenticateWeb(request, env);
  if (!user) {
    return makeRes(JSON.stringify({ success: false, error: "Unauthorized" }), 401);
  }

  const parts = path.replace("/providers", "").split("/").filter(Boolean);

  // Admin routes
  if (parts[0] === "admin") {
    if (user.role !== "admin") {
      return makeRes(JSON.stringify({ success: false, error: "Forbidden" }), 403);
    }
    if (request.method === "GET") {
      const settings = await getAllProviderSettings(env.DB);
      return makeRes(JSON.stringify({ success: true, data: settings }));
    }
    if (request.method === "PUT") {
      try {
        const body = (await request.json()) as {
          provider: string;
          enabled: number;
          fallback_pat?: string;
          rate_limit?: number;
        }[];
        for (const s of body) {
          let encryptedPat: string | null = null;
          if (s.fallback_pat && env.ENCRYPTION_KEY) {
            encryptedPat = await encryptSecret(s.fallback_pat, env.ENCRYPTION_KEY);
          }
          await upsertProviderSetting(
            env.DB,
            s.provider,
            s.enabled,
            encryptedPat,
            s.rate_limit ?? null,
          );
        }
        return makeRes(JSON.stringify({ success: true }));
      } catch {
        return makeRes(JSON.stringify({ success: false, error: "Invalid body" }), 400);
      }
    }
    return makeRes(JSON.stringify({ success: false, error: "Not Found" }), 404);
  }

  // User routes
  if (request.method === "GET" && parts.length === 0) {
    const providers = await getUserProviders(env.DB, user.id);
    return makeRes(JSON.stringify({ success: true, data: providers }), 200, {
      "Content-Type": "application/json",
    });
  }

  if (request.method === "POST" && parts[0] && parts[1] === "enable") {
    await enableUserProvider(env.DB, user.id, parts[0]);
    return makeRes(JSON.stringify({ success: true }));
  }

  if (request.method === "POST" && parts[0] && parts[1] === "disable") {
    await disableUserProvider(env.DB, user.id, parts[0]);
    return makeRes(JSON.stringify({ success: true }));
  }

  if (request.method === "PUT" && parts[0] && parts[1] === "pat") {
    try {
      const body = (await request.json()) as { pat?: string; patUsername?: string };
      let encryptedPat: string | null = null;
      if (body.pat && env.ENCRYPTION_KEY) {
        encryptedPat = await encryptSecret(body.pat, env.ENCRYPTION_KEY);
      }
      await updateUserProviderPat(
        env.DB,
        user.id,
        parts[0],
        encryptedPat,
        body.patUsername ?? null,
      );
      return makeRes(JSON.stringify({ success: true }));
    } catch {
      return makeRes(JSON.stringify({ success: false, error: "Invalid body" }), 400);
    }
  }

  if (request.method === "POST" && parts[0] && parts[1] === "rotate") {
    const newHash = await rotateUserProviderHash(env.DB, user.id, parts[0]);
    return makeRes(JSON.stringify({ success: true, data: { hash: newHash } }));
  }

  return makeRes(JSON.stringify({ success: false, error: "Not Found" }), 404);
}
