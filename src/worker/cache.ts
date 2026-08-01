// ============================================================================
// src/worker/cache.ts — Cache API 封装 (hash→PAT 热缓存)
// ============================================================================

import type { User, Credential } from "../shared/types";

const AUTH_CACHE_TTL = 60; // 60s

type WorkerCacheStorage = CacheStorage & {
  default: Cache;
};

interface CachedAuth {
  user: User;
  credential?: Credential;
}

function getWorkerCache(): Cache {
  return (caches as WorkerCacheStorage).default;
}

/**
 * 从 Cloudflare Cache API 读取缓存的 hash→PAT 映射。
 */
export async function getCachedAuth(hash: string): Promise<CachedAuth | null> {
  const cacheKey = new Request(`https://internal.cloudmirror/auth/${hash}`);
  try {
    const cached = await getWorkerCache().match(cacheKey);
    if (cached) {
      const data = (await cached.json()) as CachedAuth;
      return data;
    }
  } catch {
    // Cache miss or error — fall through to D1
  }
  return null;
}

/**
 * 将 hash→PAT 映射写入 Cloudflare Cache API。
 */
export function setCachedAuth(ctx: ExecutionContext, hash: string, data: CachedAuth): void {
  const cacheKey = new Request(`https://internal.cloudmirror/auth/${hash}`);
  const res = new Response(JSON.stringify(data), {
    headers: { "Cache-Control": `max-age=${AUTH_CACHE_TTL}` },
  });
  ctx.waitUntil(getWorkerCache().put(cacheKey, res));
}

/**
 * 主动失效缓存的 hash→PAT 映射（凭据变更时调用）。
 */
export async function invalidateCachedAuth(hash: string): Promise<void> {
  const cacheKey = new Request(`https://internal.cloudmirror/auth/${hash}`);
  try {
    await getWorkerCache().delete(cacheKey);
  } catch {
    // 缓存不可用时忽略
  }
}
