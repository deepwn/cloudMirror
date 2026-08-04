// ============================================================================
// src/worker/config.ts — 常量、上游映射、工具函数
// ============================================================================

// ---------- 平台域名（子域代理后缀，可用 env.APP_DOMAIN 覆盖） ----------

export const DEFAULT_APP_DOMAIN = "mirror.example.com";

// ---------- Docker Hub ----------

export const DOCKER_HUB_REGISTRY = "registry-1.docker.io";
export const DOCKER_HUB_INDEX = "index.docker.io";
export const DOCKER_AUTH_URL = "https://auth.docker.io";

// ---------- Preflight ----------

export const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 分钟窗口
export const DEFAULT_MAX_REQ_PER_MIN = 600;

// ---------- 缓存 ----------

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000; // 上游请求超时
export const DEFAULT_CACHE_TTL = 3600; // CF 边缘缓存（秒）
export const AUTH_CACHE_TTL = 60; // hash→PAT 映射缓存（秒）

// ---------- UA 黑名单 ----------

export const DEFAULT_BLOCKED_UA = ["netcraft"];

// ---------- Preflight ----------

export const PREFLIGHT_INIT: ResponseInit = {
  headers: new Headers({
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS",
    "access-control-max-age": "1728000",
  }),
};

// ---------- Favicon ----------

export const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">' +
  '<defs><linearGradient id="g" x1="2" y1="2" x2="46" y2="46" gradientUnits="userSpaceOnUse">' +
  '<stop offset="0%" stop-color="#4FACFE"/><stop offset="50%" stop-color="#3B82F6"/>' +
  '<stop offset="100%" stop-color="#06B6D4"/></linearGradient></defs>' +
  '<path d="M8 31C3.582 31 0 27.418 0 23C0 19.246 2.69 16.074 6.355 15.24' +
  "C6.122 14.48 6 13.675 6 12.842C6 9.287 8.686 6.346 12.145 6.053" +
  "C13.705 3.592 16.446 2 19.5 2C21.835 2 23.968 2.968 25.563 4.553" +
  "C26.654 4.191 27.828 4 29.045 4C33.024 4 36.278 7.1 36.513 11.02" +
  "C38.975 11.7 40.771 14.037 40.808 16.805C40.845 19.472 39.237 21.925" +
  " 36.8 22.965C36.6 23.05 36.5 23.25 36.5 23.5V27C36.5 30.866 33.366 34" +
  ' 29.5 34H13C10.791 34 8 32.209 8 31Z" fill="url(#g)"/>' +
  '<line x1="3" y1="36" x2="45" y2="36" stroke="white" stroke-opacity="0.9"' +
  ' stroke-width="2" stroke-linecap="round"/>' +
  '<path d="M8 42C3.582 42 0 38.418 0 34C0 30.246 2.69 27.074' +
  " 6.355 26.24C6.122 25.48 6 24.675 6 23.842C6 20.287 8.686 17.346" +
  " 12.145 17.053C13.705 14.592 16.446 13 19.5 13C21.835 13 23.968 13.968" +
  " 25.563 15.553C26.654 15.191 27.828 15 29.045 15C33.024 15 36.278 18.1" +
  " 36.513 22.02C38.975 22.7 40.771 25.037 40.808 27.805C40.845 30.472" +
  " 39.237 32.925 36.8 33.965C36.6 34.05 36.5 34.25 36.5 34.5V38" +
  'C36.5 41.866 33.366 45 29.5 45H13C10.791 45 8 43.209 8 42Z"' +
  ' fill="url(#g)" opacity="0.25"/></svg>';

export const FAVICON_SVG = LOGO_SVG;

// ============================================================================
// 工具函数
// ============================================================================

/** 解析逗号/分号/空格分隔的环境变量列表 */
export function parseEnvList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .replace(/[\t |"'\r\n;]+/g, ",")
    .replace(/,+/g, ",")
    .replace(/^,|,$/g, "")
    .split(",")
    .filter(Boolean);
}

/** 构造带 CORS 头的 Response */
export function makeRes(
  body: BodyInit | null,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  headers["access-control-allow-origin"] = "*";
  return new Response(body, { status, headers });
}

/** 安全的 URL 解析 */
export function safeUrl(urlStr: string, base?: string): URL | null {
  try {
    return new URL(urlStr, base);
  } catch (e) {
    console.error("safeUrl error:", (e as Error).message);
    return null;
  }
}

/** 带超时的 fetch */
export async function fetchWithTimeout(
  urlOrRequest: string | Request,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(urlOrRequest, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}
