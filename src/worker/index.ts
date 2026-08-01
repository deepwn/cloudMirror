// ============================================================================
// src/worker/index.ts — cloudMirror v1.0 fetch handler 入口
// ============================================================================

import type { Env } from "./providers/types";
import { parseHostname, resolveRoute } from "./router";
import { handleApi } from "./api/index";
import { getClientIP, checkRateLimit, isBlockedUA, isBlockedIP } from "./rate-limit";
import { FAVICON_SVG, LOGO_SVG, makeRes, PREFLIGHT_INIT } from "./config";
import { serveHtml } from "./html";
import { handleCron } from "./cron";
import { getRuntimeConfig } from "./settings-cache";
import { logAudit } from "./db";
import type { RuntimeConfig } from "./settings-cache";

// ============================================================================
// Worker Entry
// ============================================================================

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ---- Preflight ----
    if (request.method === "OPTIONS") {
      return new Response(null, PREFLIGHT_INIT);
    }

    // ---- Static Assets ----
    if (url.pathname === "/favicon.ico" || url.pathname === "/logo.svg") {
      return new Response(url.pathname === "/favicon.ico" ? FAVICON_SVG : LOGO_SVG, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=86400",
          "access-control-allow-origin": "*",
        },
      });
    }

    // ---- Health ----
    if (url.pathname === "/health") {
      return makeRes(JSON.stringify({ status: "ok", version: "4.0.0" }), 200, {
        "Content-Type": "application/json",
      });
    }

    // ---- Runtime Config (DB-backed, 30s TTL cache) ----
    const config = await getRuntimeConfig(env);

    // ---- Rate Limit ----
    const clientIp = getClientIP(request);

    const isWhitelisted = config.ipWhitelist
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .includes(clientIp);

    if (!isWhitelisted) {
      if (isBlockedIP(clientIp, config.ipBlacklist, config.ipWhitelist)) {
        return new Response("Forbidden", { status: 403 });
      }
      const rateLimitErr = checkRateLimit(clientIp, config.rateLimit);
      if (rateLimitErr) return rateLimitErr;
    }

    // ---- UA Block ----
    const userAgent = request.headers.get("User-Agent") ?? "";
    if (isBlockedUA(userAgent, config.uaBlock)) {
      return new Response("Forbidden", { status: 403 });
    }

    // ---- Route: 子域代理 > 平台 API > SPA（SDK v2 三态路由，子域优先） ----
    // 子域上全部路径都属于代理态（含上游 /api/ 前缀），必须先于平台 API 判定；
    // 平台 API 只在裸域 /cloudmirror-api/* 生效（见 docs/architecture.md §1.2）。
    const hostname = url.hostname;
    if (parseHostname(hostname, env.APP_DOMAIN)) {
      return handleProxyRequest(request, env, ctx, clientIp, config);
    }

    if (url.pathname.startsWith("/cloudmirror-api/")) {
      return handleApi(request, env, ctx);
    }

    // Web 前端（裸域）
    return serveHtml(request, env.ASSETS);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleCron(event, env, ctx);
  },
};

export default worker;

// ============================================================================
// v1.0: CLI 代理请求处理
// ============================================================================

async function handleProxyRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  clientIp: string,
  config: RuntimeConfig,
): Promise<Response> {
  const url = new URL(request.url);

  // 1. 解析路由：hash → user_providers → PAT 解密 → Provider 实例
  const resolved = await resolveRoute(url.hostname, env);
  if (!resolved) {
    return makeRes(JSON.stringify({ error: "invalid or disabled provider" }), 403, {
      "Content-Type": "application/json",
    });
  }

  const { route, provider } = resolved;

  // 2. 写请求门控
  const writeMethods = new Set(["PUT", "POST", "PATCH"]);
  if (writeMethods.has(request.method) && !config.allowPushUpload) {
    return makeRes(JSON.stringify({ error: "push/upload is disabled by administrator" }), 403, {
      "Content-Type": "application/json",
    });
  }

  // 3. Provider 代理执行（PAT 已在 resolveRoute 中解密，通过 route.pat 传入）
  const result = await provider.handleProxy(request, route);

  // 4. 审计日志 (fire-and-forget)
  if (result && env.DB) {
    ctx.waitUntil(
      logAudit(env.DB, "proxy_pull", {
        actorId: route.userId,
        actorIp: clientIp,
        actorUa: request.headers.get("User-Agent") || "",
        detail: JSON.stringify({
          type: route.providerType,
          path: url.pathname + url.search,
          status: result.status,
        }),
        targetType: route.providerType,
      }),
    );
  }

  if (result) return result;

  return makeRes(JSON.stringify({ error: "proxy not implemented" }), 501, {
    "Content-Type": "application/json",
  });
}
