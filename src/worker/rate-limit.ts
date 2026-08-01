// ============================================================================
// src/worker/rate-limit.ts — 速率限制 + 爆破攻击防护 (登录 / Hash 探测)
// ============================================================================
// 爆破达到阈值后不临时封禁，而是通知调用方将 IP 写入黑名单永久封禁。
// 管理员需手动从黑名单移除才能解封。
// ============================================================================

import { RATE_LIMIT_WINDOW_MS, DEFAULT_MAX_REQ_PER_MIN, makeRes } from "./config";

// ===== 速率限制存储 =====

interface RateEntry {
  windowStart: number;
  count: number;
}

const rateLimitStore = new Map<string, RateEntry>();

// ===== 登录爆破防护存储 (按 IP + username 维度) =====

interface BruteForceEntry {
  failCount: number;
  /** 是否已触发封禁信号（避免重复写入黑名单） */
  banSignaled: boolean;
}

// 按 IP 维度
const loginBruteByIp = new Map<string, BruteForceEntry>();
// 按 username 维度
const loginBruteByUser = new Map<string, BruteForceEntry>();
// 按 IP+username 组合维度
const loginBruteByCombo = new Map<string, BruteForceEntry>();

// ===== Hash 暴力探测存储 =====

interface InvalidHashEntry {
  count: number;
  firstSeen: number;
  banSignaled: boolean;
}

const invalidHashStore = new Map<string, InvalidHashEntry>();

// ===== 清理阈值 =====

const STORE_CLEANUP_THRESHOLD = 10_000;

/**
 * 检查速率限制。返回 null=通过，返回 Response=拒绝。
 * @param maxReq 每分钟最大请求数（从 RuntimeConfig.rateLimit 传入）
 */
export function checkRateLimit(ip: string, maxReq: number): Response | null {
  const limit = Math.max(1, maxReq || DEFAULT_MAX_REQ_PER_MIN);

  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  let entry = rateLimitStore.get(ip);
  if (!entry || entry.windowStart < windowStart) {
    entry = { windowStart: now, count: 1 };
    rateLimitStore.set(ip, entry);

    // 定期清理所有内存存储（避免 Worker 长时间运行导致 OOM）
    if (rateLimitStore.size + invalidHashStore.size > STORE_CLEANUP_THRESHOLD) {
      setTimeout(cleanupAllStores, 0);
    }

    return null;
  }

  entry.count++;
  if (entry.count > limit) {
    const retryAfter = Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return makeRes(
      JSON.stringify({
        error: "Too Many Requests",
        message: `Rate limit exceeded: ${limit} requests per minute`,
        retryAfter,
      }),
      429,
      {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
      },
    );
  }

  return null;
}

// ============================================================================
// 登录爆破防护 (Login Brute Force)
// ============================================================================
// 按 IP / username / IP+username 三个维度独立计数。
// 任意一个维度达到阈值即通知调用方写入 IP 黑名单（永久封禁）。
// ============================================================================

/** 默认爆破参数 */
export const BRUTE_DEFAULT_MAX_ATTEMPTS = 5;

/**
 * 检查登录爆破限制。
 * 返回 null=通过，返回 Response=IP 已被封禁（通过黑名单命中）。
 * 注意：实际 IP 黑名单检查在 index.ts 的 isBlockedIP 中完成，
 * 此函数仅检查内存中的暂存状态。
 */
export function checkLoginBruteForce(ip: string, username: string): Response | null {
  const checks: Array<{ store: Map<string, BruteForceEntry>; key: string; label: string }> = [
    { store: loginBruteByCombo, key: `${ip}:${username}`, label: "IP+账号" },
    { store: loginBruteByIp, key: ip, label: "IP" },
    { store: loginBruteByUser, key: username, label: "账号" },
  ];

  for (const { store, key, label } of checks) {
    const entry = store.get(key);
    if (entry && entry.banSignaled) {
      return makeRes(
        JSON.stringify({
          error: "Too Many Requests",
          message: `登录尝试次数过多（${label}），IP 已被加入黑名单`,
        }),
        429,
        { "Content-Type": "application/json" },
      );
    }
  }

  return null;
}

/**
 * 记录一次登录失败。
 * 达到阈值时返回需要封禁的 IP（调用方负责写入 D1 黑名单）。
 */
export function recordLoginFailed(
  ip: string,
  username: string,
  maxAttempts: number = BRUTE_DEFAULT_MAX_ATTEMPTS,
): string | null {
  let shouldBan: string | null = null;

  for (const { store, key } of [
    { store: loginBruteByCombo, key: `${ip}:${username}` },
    { store: loginBruteByIp, key: ip },
    { store: loginBruteByUser, key: username },
  ]) {
    let entry = store.get(key);
    if (!entry) {
      entry = { failCount: 1, banSignaled: false };
    } else if (!entry.banSignaled) {
      entry.failCount++;
    }
    if (entry.failCount >= maxAttempts && !entry.banSignaled) {
      entry.banSignaled = true;
      if (key === ip || key.startsWith(ip + ":")) {
        shouldBan = ip;
      }
    }
    store.set(key, entry);
  }

  return shouldBan;
}

/**
 * 登录成功后清除所有维度的失败记录。
 */
export function clearLoginAttempts(ip: string, username: string): void {
  loginBruteByCombo.delete(`${ip}:${username}`);
  loginBruteByIp.delete(ip);
  loginBruteByUser.delete(username);
}

// ============================================================================
// Hash 暴力探测防护 (Subdomain Hash Brute Force)
// ============================================================================

/**
 * 记录一次无效 hash 访问（hash 不存在于 D1）。
 * 达到阈值时返回需要封禁的 IP（调用方负责写入 D1 黑名单）。
 *
 * 返回 null=放行，返回 Response=已在黑名单。
 */
export function recordInvalidHash(
  ip: string,
  maxAttempts: number = BRUTE_DEFAULT_MAX_ATTEMPTS,
): { response?: Response; shouldBan?: string } {
  const now = Date.now();

  let entry = invalidHashStore.get(ip);
  if (!entry) {
    entry = { count: 1, firstSeen: now, banSignaled: false };
    invalidHashStore.set(ip, entry);
    return {};
  }

  // 已发出封禁信号
  if (entry.banSignaled) {
    return {
      response: makeRes(
        JSON.stringify({
          error: "Too Many Requests",
          message: "无效子域尝试次数过多，IP 已被加入黑名单",
        }),
        429,
        { "Content-Type": "application/json" },
      ),
    };
  }

  entry.count++;

  if (entry.count >= maxAttempts) {
    entry.banSignaled = true;
    return {
      shouldBan: ip,
      response: makeRes(
        JSON.stringify({
          error: "Too Many Requests",
          message: "无效子域尝试次数已达上限，IP 已被加入黑名单",
        }),
        429,
        { "Content-Type": "application/json" },
      ),
    };
  }

  return {};
}

/**
 * 统一清理所有内存存储的过期条目。
 * 在速率检查触发阈值时异步调用，防止 Worker isolate 长时间运行导致 OOM。
 */
function cleanupAllStores(): void {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;

  // 速率限制条目
  for (const [key, val] of rateLimitStore) {
    if (val.windowStart < cutoff) rateLimitStore.delete(key);
  }

  // 无效 hash 探测记录（保留 10 分钟）
  const hashCutoff = Date.now() - 600_000;
  for (const [key, entry] of invalidHashStore) {
    if (entry.firstSeen < hashCutoff) invalidHashStore.delete(key);
  }

  // 登录爆破记录（保留 10 分钟）
  for (const store of [loginBruteByIp, loginBruteByUser, loginBruteByCombo]) {
    store.clear();
  }
}

/**
 * 定期清理过期的无效 hash 记录和爆破记录。
 * @deprecated 使用 cleanupAllStores() 统一清理。
 */
export function cleanupInvalidHashes(): void {
  cleanupAllStores();
}

/**
 * 检查 IP 是否在黑名单中，或在白名单中（白名单优先，免限速和黑名单）。
 * 返回 true=应拒绝。
 */
export function isBlockedIP(clientIp: string, ipBlacklist: string, ipWhitelist: string): boolean {
  // 白名单优先 — 即便在黑名单中也放行
  if (ipWhitelist) {
    const whitelist = ipWhitelist
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (whitelist.includes(clientIp)) return false;
  }
  if (ipBlacklist) {
    const blacklist = ipBlacklist
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (blacklist.includes(clientIp)) return true;
  }
  return false;
}

/**
 * 检查 UA 黑名单。
 * 返回 true=被封禁。
 */
export function isBlockedUA(userAgent: string, envBlockRaw: string | undefined | null): boolean {
  const blocked = ["netcraft"]; // DEFAULT_BLOCKED_UA
  if (envBlockRaw) {
    blocked.push(
      ...envBlockRaw
        .replace(/[\t |"'\r\n;]+/g, ",")
        .split(",")
        .filter(Boolean),
    );
  }
  const uaLower = userAgent.toLowerCase();
  return blocked.some((ua) => uaLower.includes(ua.toLowerCase()));
}

/**
 * 获取客户端 IP（兼容 CF Workers / 本地开发）。
 */
export function getClientIP(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    request.headers.get("X-Real-IP") ??
    "unknown"
  );
}
