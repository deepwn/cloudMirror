// ============================================================================
// src/worker/providers/types.ts — v1.0: Env 类型 (wrangler.toml bindings + secrets)
// ============================================================================

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  ASSETS: Fetcher;
  /** 平台域名（子域代理后缀，如 mirror.example.com）。缺省用 mirror.example.com。 */
  APP_DOMAIN?: string;
}

