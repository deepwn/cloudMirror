// ============================================================================
// src/worker/router.ts — 子域名解析 {hash}.{APP_DOMAIN}
// ============================================================================

import { getUserProviderByHash, getProviderSetting, getCredentials } from "./db";
import { getProvider } from "../providers/registry";
import { decryptSecret } from "./crypto";
import { DEFAULT_APP_DOMAIN } from "./config";
import type { Env } from "./providers/types";
import type { ResolvedRoute } from "../shared/types";
import type { ProviderDefinition } from "../providers/_base";

/**
 * 解析 hostname，提取 hash。
 * 格式: {hash}.{appDomain} → hash；裸域/其他返回 null。
 */
export function parseHostname(
  hostname: string,
  appDomain: string = DEFAULT_APP_DOMAIN,
): string | null {
  const suffix = "." + appDomain;
  if (!hostname.endsWith(suffix)) return null;
  const hash = hostname.slice(0, -suffix.length);
  if (!hash || hash.includes(".")) return null;
  if (!/^[a-f0-9]{16}$/.test(hash)) return null;
  return hash;
}

/**
 * 解析代理路由：hash → user_providers → provider_settings → PAT 解密 → ProviderDefinition
 */
export async function resolveRoute(
  hostname: string,
  env: Env,
): Promise<{ route: ResolvedRoute; provider: ProviderDefinition } | null> {
  const hash = parseHostname(hostname, env.APP_DOMAIN ?? DEFAULT_APP_DOMAIN);
  if (!hash) return null;
  if (!env.DB) return null;

  const up = await getUserProviderByHash(env.DB, hash);
  if (!up || !up.enabled) return null;

  const ps = await getProviderSetting(env.DB, up.provider);
  if (ps && !ps.enabled) return null;

  const provider = getProvider(up.provider);
  if (!provider) return null;

  // 解密 PAT: 用户自设(全局令牌)优先 → 访问凭据表(随机轮询) → 管理员全局 fallback
  let pat: string | null = null;
  let patUsername: string | null = up.pat_username;
  if (up.pat && env.ENCRYPTION_KEY) {
    pat = await decryptSecret(up.pat, env.ENCRYPTION_KEY);
  } else {
    // credentials 表（前端"访问凭据"，getCredentials 已过滤 is_active=1）
    // 多凭据时随机轮询实现负载均衡（与 authenticateCli 同策略）
    const creds = await getCredentials(env.DB, up.user_id, up.provider);
    if (creds.length > 0) {
      const selected = creds[Math.floor(Math.random() * creds.length)];
      pat = await decryptSecret(selected.secret, env.ENCRYPTION_KEY);
      patUsername = selected.username;
    } else if (ps?.fallback_pat && env.ENCRYPTION_KEY) {
      pat = await decryptSecret(ps.fallback_pat, env.ENCRYPTION_KEY);
    }
  }

  return {
    route: {
      userId: up.user_id,
      providerType: up.provider,
      pat,
      patUsername,
    },
    provider,
  };
}
