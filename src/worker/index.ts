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
import {
  logAudit,
  logUsage,
  getCaptureSessionByHash,
  insertCaptureLog,
  getNextCaptureSeq,
  truncateCaptureField,
  trimCaptureLogs,
} from "./db";
import type { CaptureSession } from "../shared/types";
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
  const hash = parseHostname(url.hostname, env.APP_DOMAIN) ?? "";

  // 0. Capture 子域：录制请求而非转发（构造未知 CLI 流程的 Provider 时使用）
  const captureSession = env.DB
    ? await getCaptureSessionByHash(env.DB, hash)
    : null;
  if (captureSession) {
    return handleCaptureRequest(request, env, ctx, clientIp, captureSession);
  }

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

  // 4. 用量日志 + 审计日志 (fire-and-forget)
  //    用量(usage_logs)：每请求计数/字节/耗时，供 dashboard 图表（聚合+滚动清理）
  //    审计(audit_logs)：操作摘要（含 docker auth 诊断/限流归属），detail 由 logAudit 截断保护
  if (result && env.DB) {
    const ua = request.headers.get("User-Agent") || "";
    const bytesOut = Number(result.headers.get("content-length")) || 0;
    ctx.waitUntil(
      logUsage(
        env.DB,
        route.userId,
        route.providerType,
        url.pathname + url.search,
        request.method,
        result.status,
        0, // bytesIn 不统计（代理读流后难精确，略）
        bytesOut,
        0, // duration 由调用方评估，此处不统计
        clientIp,
      ),
    );

    const detail: Record<string, string | number> = {
      type: route.providerType,
      path: url.pathname + url.search,
      status: result.status,
    };
    const debugAuth = result.headers.get("X-Cf-Debug-Auth");
    if (debugAuth) detail.authDebug = debugAuth;
    const rlSource = result.headers.get("docker-ratelimit-source");
    if (rlSource) detail.ratelimitSource = rlSource;
    const rlRemaining = result.headers.get("ratelimit-remaining");
    if (rlRemaining) detail.ratelimitRemaining = rlRemaining;

    ctx.waitUntil(
      logAudit(env.DB, "proxy_pull", {
        actorId: route.userId,
        actorIp: clientIp,
        actorUa: ua,
        detail: JSON.stringify(detail),
        targetType: route.providerType,
      }),
    );
  }

  if (result) return result;

  return makeRes(JSON.stringify({ error: "proxy not implemented" }), 501, {
    "Content-Type": "application/json",
  });
}

// ============================================================================
// Capture 录制管线：不转发，完整录制请求并返回合成响应
// ============================================================================

async function handleCaptureRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  clientIp: string,
  session: CaptureSession,
): Promise<Response> {
  const url = new URL(request.url);

  // ---- 1. 录制请求（截断 body/headers）----
  let rawBody: string | null = null;
  try {
    if (request.body) {
      const text = await request.text();
      rawBody = truncateCaptureField(text);
    }
  } catch {
    /* body read failed — record as null */
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    if (k.toLowerCase() === "authorization") {
      headers[k] = v.slice(0, 32) + (v.length > 32 ? "…" : "");
    } else {
      headers[k] = v;
    }
  });

  const seq = await getNextCaptureSeq(env.DB, session.id);

  // ---- 2. transparent 模式：真实转发到 target_upstream，返回真实响应 ----
  if (session.mode === "transparent" && session.target_upstream) {
    return handleTransparentCapture(
      request,
      env,
      ctx,
      clientIp,
      session,
      seq,
      headers,
      rawBody,
    );
  }

  await insertCaptureLog(
    env.DB,
    session.id,
    seq,
    request.method,
    url.pathname + url.search,
    truncateCaptureField(JSON.stringify(headers), 8 * 1024),
    rawBody,
    null,
    null,
    null,
    clientIp,
    request.headers.get("User-Agent") || null,
  );
  // 会话日志条数上限保护
  await trimCaptureLogs(env.DB, session.id);

  // ---- 3. 合成响应 ----
  let status = 200;
  let respHeaders = new Headers({ "Access-Control-Allow-Origin": "*" });
  let body = "";

  if (session.mode === "challenge") {
    // OCI/Registry 类：401 + WWW-Authenticate → CLI 自动发起 token 请求
    status = 401;
    const host = url.host;
    respHeaders.set(
      "WWW-Authenticate",
      `Bearer realm="https://${host}/token",service="${host}"`,
    );
    respHeaders.set("Content-Type", "application/json");
    body = JSON.stringify({ errors: [{ code: "UNAUTHORIZED", message: "authentication required" }] });
  } else if (session.mode === "custom") {
    status = session.custom_status ?? 200;
    if (session.custom_headers) {
      try {
        const ch = JSON.parse(session.custom_headers) as Record<string, string>;
        for (const [k, v] of Object.entries(ch)) respHeaders.set(k, v);
      } catch {
        /* ignore malformed custom headers */
      }
    }
    body = session.custom_body ?? "";
    if (!respHeaders.has("Content-Type")) respHeaders.set("Content-Type", "text/plain");
  } else {
    // echo：回显请求信息
    respHeaders.set("Content-Type", "application/json");
    body = JSON.stringify({
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers,
      body: rawBody,
      seq,
      capturedAt: new Date().toISOString(),
      message: "captured by cloudMirror capture provider",
    });
  }

  respHeaders.set("X-Cf-Capture", "1");
  respHeaders.set("X-Cf-Capture-Seq", String(seq));

  // ---- 4. 审计 ----
  ctx.waitUntil(
    logAudit(env.DB, "capture_request", {
      actorId: session.user_id,
      actorIp: clientIp,
      actorUa: request.headers.get("User-Agent") || "",
      detail: JSON.stringify({
        sessionId: session.id,
        method: request.method,
        path: url.pathname + url.search,
        seq,
        status,
      }),
      targetType: "capture",
      targetId: session.id,
    }),
  );

  return new Response(body, { status, headers: respHeaders });
}

/**
 * transparent 模式：把请求真实转发到 target_upstream，返回真实响应给 CLI，
 * 同时完整记录 请求 + 真实响应（status/headers/body 摘要）。
 * - /token 路径转发到 target_auth（OCI token 服务器），否则转发到 target_upstream
 * - 重写 Location 与 WWW-Authenticate 的 realm → mirror，保证后续请求/认证也走 mirror
 */
async function handleTransparentCapture(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  clientIp: string,
  session: CaptureSession,
  seq: number,
  headers: Record<string, string>,
  reqBody: string | null,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // 选择目标：/token 优先走 target_auth（OCI），否则 target_upstream
  const isToken = path === "/token" || path.startsWith("/token/");
  const targetBase = isToken && session.target_auth ? session.target_auth : session.target_upstream!;
  let targetUrl: URL;
  try {
    targetUrl = new URL(targetBase);
  } catch {
    return new Response("invalid target_upstream", { status: 502 });
  }

  const upUrl = new URL(targetUrl.origin + path + url.search);
  const reqHeaders = new Headers();
  // 透传关键头（Host 改为目标上游）
  for (const h of ["Accept", "Accept-Encoding", "Content-Type", "Range", "User-Agent"]) {
    const v = request.headers.get(h);
    if (v) reqHeaders.set(h, v);
  }
  const clientAuth = request.headers.get("Authorization");
  if (clientAuth) reqHeaders.set("Authorization", clientAuth);
  reqHeaders.set("Host", targetUrl.host);

  const body = ["GET", "HEAD"].includes(request.method) ? undefined : request.body;
  let upRes: Response;
  try {
    upRes = await fetch(upUrl.toString(), {
      method: request.method,
      headers: reqHeaders,
      body,
      redirect: "manual",
    });
  } catch (err) {
    // 上游不可达：仍记录请求（resp_status=502），并返回 502
    const respBodyErr = `upstream error: ${(err as Error).message}`;
    await insertCaptureLog(
      env.DB,
      session.id,
      seq,
      request.method,
      url.pathname + url.search,
      truncateCaptureField(JSON.stringify(headers), 8 * 1024),
      reqBody,
      502,
      "{}",
      truncateCaptureField(respBodyErr),
      clientIp,
      request.headers.get("User-Agent") || null,
    );
    await trimCaptureLogs(env.DB, session.id);
    return new Response(respBodyErr, { status: 502 });
  }

  // 读取响应体（克隆以保留流）
  const respText = await upRes.clone().text();
  const respBody = truncateCaptureField(respText);

  // 记录：请求 + 真实响应摘要
  const respHeadersObj: Record<string, string> = {};
  upRes.headers.forEach((v, k) => {
    if (k.toLowerCase() === "www-authenticate" || k.toLowerCase() === "location") return;
    respHeadersObj[k] = v;
  });
  await insertCaptureLog(
    env.DB,
    session.id,
    seq,
    request.method,
    url.pathname + url.search,
    truncateCaptureField(JSON.stringify(headers), 8 * 1024),
    reqBody,
    upRes.status,
    truncateCaptureField(JSON.stringify(respHeadersObj), 8 * 1024),
    respBody,
    clientIp,
    request.headers.get("User-Agent") || null,
  );
  await trimCaptureLogs(env.DB, session.id);

  // 重写响应头（Location / WWW-Authenticate realm → mirror）
  const outHeaders = new Headers(upRes.headers);
  const mirrorHost = url.host;
  const loc = outHeaders.get("Location");
  if (loc) {
    outHeaders.set("Location", loc.replace(targetUrl.origin, `https://${mirrorHost}`));
  }
  const wa = outHeaders.get("WWW-Authenticate");
  if (wa) {
    // 把 realm 指向 mirror 的 /token（OCI 流程：CLI token 请求回到 mirror 再转发）
    outHeaders.set(
      "WWW-Authenticate",
      wa.replace(/realm="[^"]+"/, `realm="https://${mirrorHost}/token"`),
    );
  }
  outHeaders.set("Access-Control-Allow-Origin", "*");
  outHeaders.set("X-Cf-Capture", "1");
  outHeaders.set("X-Cf-Capture-Seq", String(seq));

  // 审计
  ctx.waitUntil(
    logAudit(env.DB, "capture_request", {
      actorId: session.user_id,
      actorIp: clientIp,
      actorUa: request.headers.get("User-Agent") || "",
      detail: JSON.stringify({
        sessionId: session.id,
        method: request.method,
        path: url.pathname + url.search,
        seq,
        status: upRes.status,
        transparent: true,
      }),
      targetType: "capture",
      targetId: session.id,
    }),
  );

  return new Response(respText, { status: upRes.status, headers: outHeaders });
}
