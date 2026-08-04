// ============================================================================
// src/worker/api/debug.ts — 调试工具 API（管理员 Postman 式单次请求）
// ============================================================================
// 用法: POST /cloudmirror-api/v1/debug-fetch
// Body: {
//   method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE"|"HEAD"|"OPTIONS",
//   url: "https://...",
//   headers?: { [k]: v },
//   body?: string
// }
// 响应: { success, data: { ok, status, statusText, headers, body, truncated, durationMs, finalUrl } }
// 安全: 需 Web JWT + admin 角色；SSRF 防护（拒绝内网/IP/localhost/云 metadata）。
// ============================================================================

import { makeRes } from "../config";
import type { Env } from "../providers/types";
import { authenticateWeb } from "../auth";
import { logAudit } from "../db";

const MAX_RESPONSE_BODY = 256 * 1024; // 响应体截断阈值 256KB
const MAX_REQUEST_BODY = 1024 * 1024; // 请求体上限 1MB
const TIMEOUT_MS = 15_000; // 上游超时

/**
 * SSRF 防护（与 _base.ts validateContract 同规则，但放行 localhost/127.0.0.1）。
 * 拒绝：IP 字面量（127.0.0.1 除外）、IPv6、内网保留段（10.x / 172.16-31.x / 192.168.x / 169.254.x）。
 * 说明：Cloudflare Worker 无同机监听服务，放行 localhost 仅用于本地 dev 调试"访问自身"；
 *      云 metadata（169.254.169.254）与内网段始终拦截。
 */
function isBlockedHost(hostname: string): boolean {
  if (!hostname) return true;
  if (hostname.includes(":")) return true; // IPv6
  // 仅放行 127.0.0.1（本地调试）；其余 IPv4 字面量一律拒绝
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return hostname !== "127.0.0.1";
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;
  if (/^(10|127|169\.254|192\.168)\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  return false;
}

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export async function handleDebugFetchRoute(request: Request, env: Env): Promise<Response> {
  // ---- 认证：Web JWT + admin ----
  const user = await authenticateWeb(request, env);
  if (!user) {
    return makeRes(JSON.stringify({ success: false, error: "Unauthorized" }), 401, {
      "Content-Type": "application/json",
    });
  }
  if (user.role !== "admin") {
    return makeRes(JSON.stringify({ success: false, error: "Forbidden: admin only" }), 403, {
      "Content-Type": "application/json",
    });
  }

  if (request.method !== "POST") {
    return makeRes(JSON.stringify({ success: false, error: "Method not allowed" }), 405, {
      "Content-Type": "application/json",
    });
  }

  // ---- 解析 Body ----
  let body: { method?: string; url?: string; headers?: Record<string, string>; body?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return makeRes(JSON.stringify({ success: false, error: "Invalid JSON body" }), 400, {
      "Content-Type": "application/json",
    });
  }

  const method = (body.method ?? "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return makeRes(JSON.stringify({ success: false, error: `Unsupported method: ${method}` }), 400, {
      "Content-Type": "application/json",
    });
  }
  if (!body.url) {
    return makeRes(JSON.stringify({ success: false, error: "Missing url field" }), 400, {
      "Content-Type": "application/json",
    });
  }

  // ---- URL + SSRF 校验 ----
  let targetUrl: URL;
  try {
    targetUrl = new URL(body.url);
  } catch {
    return makeRes(JSON.stringify({ success: false, error: "Invalid URL" }), 400, {
      "Content-Type": "application/json",
    });
  }
  if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
    return makeRes(
      JSON.stringify({ success: false, error: "Only http/https URLs are allowed" }),
      400,
      { "Content-Type": "application/json" },
    );
  }
  if (isBlockedHost(targetUrl.hostname)) {
    return makeRes(
      JSON.stringify({ success: false, error: `Blocked host: ${targetUrl.hostname}` }),
      403,
      { "Content-Type": "application/json" },
    );
  }

  // ---- 构造上游请求 ----
  const reqHeaders = new Headers();
  reqHeaders.set("User-Agent", "CloudMirror-Debug/1.0");
  if (body.headers) {
    for (const [k, v] of Object.entries(body.headers)) {
      if (!k.trim()) continue;
      // 防 CRLF 注入
      if (/[\r\n]/.test(k) || /[\r\n]/.test(v ?? "")) continue;
      reqHeaders.set(k.trim(), String(v ?? ""));
    }
  }

  let payload: BodyInit | null = null;
  if (method !== "GET" && method !== "HEAD" && body.body) {
    if (body.body.length > MAX_REQUEST_BODY) {
      return makeRes(
        JSON.stringify({ success: false, error: "Request body exceeds 1MB limit" }),
        413,
        { "Content-Type": "application/json" },
      );
    }
    payload = body.body;
  }

  // ---- 执行请求（带超时 + 手动重定向跟踪 finalUrl）----
  const started = Date.now();
  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      res = await fetch(targetUrl.toString(), {
        method,
        headers: reqHeaders,
        body: payload,
        redirect: "follow",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const msg = (err as Error).name === "AbortError" ? `Timeout after ${TIMEOUT_MS}ms` : (err as Error).message;
    return makeRes(JSON.stringify({ success: false, error: msg }), 502, {
      "Content-Type": "application/json",
    });
  }
  const durationMs = Date.now() - started;

  // ---- 读取并截断响应体 ----
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    return makeRes(JSON.stringify({ success: false, error: (err as Error).message }), 502, {
      "Content-Type": "application/json",
    });
  }
  const truncated = text.length > MAX_RESPONSE_BODY;
  if (truncated) text = text.slice(0, MAX_RESPONSE_BODY);

  const outHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    outHeaders[k] = v;
  });

  // ---- 审计 ----
  if (env.DB) {
    const ip =
      request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
      "unknown";
    try {
      await logAudit(env.DB, "debug_fetch", {
        actorId: user.id,
        actorIp: ip,
        actorUa: request.headers.get("User-Agent") || "",
        targetType: "debug",
        detail: JSON.stringify({
          method,
          url: targetUrl.toString(),
          status: res.status,
          durationMs,
        }),
      });
    } catch {
      /* audit failure is non-fatal */
    }
  }

  return makeRes(
    JSON.stringify({
      success: true,
      data: {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers: outHeaders,
        body: text,
        truncated,
        durationMs,
        finalUrl: res.url,
      },
    }),
    200,
    { "Content-Type": "application/json" },
  );
}
