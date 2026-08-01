// ============================================================================
// src/worker/api/fetch.ts — 通用 HTTP 代理端点（SDK v2 §5.7）
// ============================================================================
// 所有 Provider 的详情 API 请求必须通过 Worker 后端代理，避免浏览器 CORS 限制。
// 用法: POST /cloudmirror-api/v1/fetch  { url: "https://...", headers?: {...}, type?: "json"|"text" }
// 白名单由 Provider 声明（proxy.routes/search/infoEndpoint/tabs）自动派生，不再手维护。
// ============================================================================

import { makeRes } from "../config";
import type { Env } from "../providers/types";
import { getAllProviders } from "../../providers/registry";

/**
 * 从 Provider 声明派生全部上游 host（单一事实源）。
 * 来源：upstream / proxy.routes / search.endpoint / detail.infoEndpoint / tabs endpoint。
 * 仅收录 https，且注册期 manager.validate() 已做 https 强制校验（SSRF 防护）。
 */
export function collectProxyUpstreams(): string[] {
  const hosts = new Set<string>();
  const pushHost = (url: string) => {
    try {
      const u = new URL(url);
      if (u.protocol === "https:") hosts.add(u.hostname);
    } catch {
      /* invalid url skipped */
    }
  };

  for (const p of getAllProviders()) {
    pushHost(p.upstream);
    for (const r of p.proxy.routes ?? []) pushHost(r.upstream);
    if (p.search?.endpoint) pushHost(p.search.endpoint);
    const detail = p.defineDetail();
    pushHost(detail.infoEndpoint.replace("{target}", "x"));
    for (const t of detail.tabs) pushHost(t.dataSource.endpoint.replace("{target}", "x"));
  }
  return [...hosts].sort();
}

const ALLOWED_HOSTS = collectProxyUpstreams();

export async function handleFetchRoute(request: Request, _env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return makeRes(JSON.stringify({ error: "Method not allowed" }), 405, {
      "Content-Type": "application/json",
    });
  }

  let body: { url?: string; headers?: Record<string, string>; type?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return makeRes(JSON.stringify({ error: "Invalid JSON body" }), 400, {
      "Content-Type": "application/json",
    });
  }

  if (!body.url) {
    return makeRes(JSON.stringify({ error: "Missing url field" }), 400, {
      "Content-Type": "application/json",
    });
  }

  // 安全校验：只允许白名单域名
  let targetUrl: URL;
  try {
    targetUrl = new URL(body.url);
  } catch {
    return makeRes(JSON.stringify({ error: "Invalid URL" }), 400, {
      "Content-Type": "application/json",
    });
  }

  const allowed = ALLOWED_HOSTS.some(
    (host) => targetUrl.hostname === host || targetUrl.hostname.endsWith("." + host),
  );
  if (!allowed) {
    return makeRes(JSON.stringify({ error: `Host not allowed: ${targetUrl.hostname}` }), 403, {
      "Content-Type": "application/json",
    });
  }

  // 构造请求头
  const fetchHeaders = new Headers();
  fetchHeaders.set("User-Agent", "CloudMirror/4.0");
  fetchHeaders.set(
    "Accept",
    body.type === "text" ? "text/plain, text/markdown, text/html" : "application/json",
  );
  if (body.headers) {
    for (const [k, v] of Object.entries(body.headers)) {
      fetchHeaders.set(k, v);
    }
  }

  try {
    const res = await fetch(body.url, {
      headers: fetchHeaders,
      redirect: "follow",
    });

    const responseHeaders = new Headers();
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set(
      "Content-Type",
      res.headers.get("Content-Type") ?? "application/octet-stream",
    );

    const data = body.type === "text" ? await res.text() : await res.text();
    const isJson = !body.type || body.type === "json";
    const responseBody = isJson
      ? JSON.stringify({ ok: res.ok, status: res.status, body: data, isJson: true })
      : JSON.stringify({ ok: res.ok, status: res.status, body: data, isJson: false });

    return new Response(responseBody, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (err) {
    return makeRes(JSON.stringify({ error: (err as Error).message }), 502, {
      "Content-Type": "application/json",
    });
  }
}
