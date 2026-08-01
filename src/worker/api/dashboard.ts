// ============================================================================
// src/worker/api/dashboard.ts — /api/v1/dashboard 用户控制台 API
// ============================================================================

import type { Env } from "../providers/types";
import { makeRes } from "../config";
import { authenticateWeb } from "../auth";
import { getCredentials, getDailyUsage, getLimits } from "../db";

/**
 * 获取当前用户的仪表盘摘要。
 * GET /api/v1/dashboard/summary
 */
async function getSummary(request: Request, env: Env): Promise<Response> {
  const user = await authenticateWeb(request, env);
  if (!user) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);

  const [credentials, usage, limits] = await Promise.all([
    getCredentials(env.DB, user.id).catch(() => []),
    getDailyUsage(env.DB, user.id, 30).catch(() => []),
    getLimits(env.DB, user.id).catch(() => []),
  ]);

  // Aggregate usage
  const totalRequests = usage.reduce((sum, d) => sum + d.requests, 0);
  const totalBytesOut = usage.reduce((sum, d) => sum + d.bytes_out, 0);
  const totalCacheHits = usage.reduce((sum, d) => sum + d.cache_hits, 0);

  // Providers with credentials
  const providerMask = new Set(credentials.map((c) => c.provider));

  return makeRes(
    JSON.stringify({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          status: user.status,
          created_at: user.created_at,
        },
        stats: {
          totalRequests,
          totalBytesOut,
          totalCacheHits,
          cacheHitRate:
            totalRequests > 0 ? Math.round((totalCacheHits / totalRequests) * 100) / 100 : 0,
          credentialCount: credentials.length,
        },
        providers: {
          docker: providerMask.has("docker"),
          ghcr: providerMask.has("ghcr"),
          gcr: providerMask.has("gcr"),
          quay: providerMask.has("quay"),
          k8s: providerMask.has("k8s"),
          nvcr: providerMask.has("nvcr"),
          github: providerMask.has("github"),
          hf: providerMask.has("hf"),
        },
        limits: limits.map((l) => ({
          provider: l.provider,
          rateLimit: l.rate_limit,
          bandwidthLimit: l.bandwidth_limit,
          concurrency: l.concurrency,
          expiresAt: l.expires_at,
        })),
      },
    }),
  );
}

/**
 * 获取用户的每日用量详情。
 * GET /api/v1/dashboard/usage?days=7
 */
async function getUsage(request: Request, env: Env): Promise<Response> {
  const user = await authenticateWeb(request, env);
  if (!user) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);

  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get("days") || "30", 10) || 30));

  const usage = await getDailyUsage(env.DB, user.id, days).catch(() => []);

  return makeRes(
    JSON.stringify({
      success: true,
      data: usage.map((d) => ({
        date: d.date,
        provider: d.provider,
        requests: d.requests,
        bytesIn: d.bytes_in,
        bytesOut: d.bytes_out,
        cacheHits: d.cache_hits,
      })),
    }),
  );
}

/**
 * Dashboard 路由分发。
 */
export async function handleDashboardRoute(
  request: Request,
  env: Env,
  subPath: string,
): Promise<Response> {
  const action = subPath.replace(/^\//, "").split("/")[0];

  switch (action) {
    case "summary":
      return getSummary(request, env);
    case "usage":
      return getUsage(request, env);
    default:
      return makeRes(JSON.stringify({ error: "dashboard endpoint not found" }), 404);
  }
}
