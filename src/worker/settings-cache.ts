// ============================================================================
// src/worker/settings-cache.ts — Runtime 配置缓存层
// ============================================================================
// 从 D1 settings 表读取安全/限流配置，TTL 缓存避免每次请求打 D1。
// admin 更新 settings 时通过 invalidateRuntimeConfig() 主动失效。
// ============================================================================

import type { Env } from "./providers/types";
import { getAllSettings } from "./db";

// ===== 运行时配置 =====

export interface RuntimeConfig {
  /** 全局限速（每分钟最大请求数），默认 600 */
  rateLimit: number;
  /** UA 黑名单关键词，逗号分隔，默认 "" */
  uaBlock: string;
  /** IP 黑名单，逗号分隔，默认 "" */
  ipBlacklist: string;
  /** IP 白名单（白名单 IP 不受限速和黑名单影响），逗号分隔，默认 "" */
  ipWhitelist: string;
  /** 用户黑名单（用户名），逗号分隔，默认 "" */
  userBlacklist: string;
  /** GitHub PAT — 提升搜索频次 / 代理回退 */
  githubToken: string;
  /** HuggingFace Token — 提升搜索频次 / 代理回退 */
  hfToken: string;
  /** 爆破保护：最大失败尝试次数，默认 5 */
  bruteLimitAttempts: number;
  /** 审计日志最大行数，默认 100000 */
  auditMaxRows: number;
  /** 日志统一保留天数（审计+用量），默认 90 */
  logRetentionDays: number;
  /** 是否允许 push/upload，默认 false */
  allowPushUpload: boolean;
  /** 密码最小长度，默认 8 */
  pwdMinLength: number;
  /** 是否要求数字，默认 false */
  pwdRequireNumber: boolean;
  /** 是否要求符号，默认 false */
  pwdRequireSymbol: boolean;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  rateLimit: 600,
  uaBlock: "",
  ipBlacklist: "",
  ipWhitelist: "",
  userBlacklist: "",
  githubToken: "",
  hfToken: "",
  bruteLimitAttempts: 5,
  auditMaxRows: 100000,
  logRetentionDays: 90,
  allowPushUpload: false,
  pwdMinLength: 8,
  pwdRequireNumber: false,
  pwdRequireSymbol: false,
};

// ===== 缓存 =====

const CACHE_TTL_MS = 30_000; // 30s TTL

interface CacheEntry {
  config: RuntimeConfig;
  ts: number;
}

let _cache: CacheEntry | null = null;

/**
 * 获取运行时配置（带 30s TTL 内存缓存）。
 * 首次调用或缓存过期时从 D1 读取，否则直接返回缓存。
 */
export async function getRuntimeConfig(env: Env): Promise<RuntimeConfig> {
  const now = Date.now();
  if (_cache && now - _cache.ts < CACHE_TTL_MS) {
    return _cache.config;
  }

  // Cache miss / stale → 从 D1 读取
  const config = { ...DEFAULT_CONFIG };

  if (env.DB) {
    try {
      const rows = await getAllSettings(env.DB);

      for (const { key, value } of rows) {
        switch (key) {
          case "rate_limit":
            config.rateLimit = Math.max(1, parseInt(value, 10) || DEFAULT_CONFIG.rateLimit);
            break;
          case "ua_block":
            config.uaBlock = value;
            break;
          case "ip_blacklist":
            config.ipBlacklist = value;
            break;
          case "ip_whitelist":
            config.ipWhitelist = value;
            break;
          case "user_blacklist":
            config.userBlacklist = value;
            break;
          case "github_token":
            config.githubToken = value;
            break;
          case "hf_token":
            config.hfToken = value;
            break;
          case "brute_limit_attempts":
            config.bruteLimitAttempts = Math.max(
              1,
              parseInt(value, 10) || DEFAULT_CONFIG.bruteLimitAttempts,
            );
            break;
          case "audit_max_rows":
            config.auditMaxRows = Math.max(
              1000,
              parseInt(value, 10) || DEFAULT_CONFIG.auditMaxRows,
            );
            break;
          case "log_retention_days":
            config.logRetentionDays = Math.max(
              1,
              parseInt(value, 10) || DEFAULT_CONFIG.logRetentionDays,
            );
            break;
          case "allow_push_upload":
            config.allowPushUpload = value === "1";
            break;
          case "pwd_min_length":
            config.pwdMinLength = Math.max(8, parseInt(value, 10) || DEFAULT_CONFIG.pwdMinLength);
            break;
          case "pwd_require_number":
            config.pwdRequireNumber = value === "1";
            break;
          case "pwd_require_symbol":
            config.pwdRequireSymbol = value === "1";
            break;
        }
      }
    } catch (err) {
      console.error("[settings-cache] D1 read failed, using defaults:", (err as Error).message);
    }
  }

  _cache = { config, ts: now };
  return config;
}

/**
 * 主动失效缓存 — admin 更新 settings 后调用。
 */
export function invalidateRuntimeConfig(): void {
  _cache = null;
}
