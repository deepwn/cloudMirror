// ============================================================================
// src/worker/api/search.ts — v1.0: 统一搜索，直接调用 Provider.doSearch()
// ============================================================================

import { makeRes } from "../config";
import type { Env } from "../providers/types";
import { getProvider } from "../../providers/registry";
import { getAllProviders } from "../../providers/registry";
import { verify } from "../jwt";
import { getUserProviderByUserAndProvider } from "../db";
import { decryptSecret } from "../crypto";

/** 从请求的 Authorization 头解析用户 PAT，失败返回 undefined */
async function resolveUserPat(
  request: Request,
  providerType: string,
  env: Env,
): Promise<string | undefined> {
  if (!env.DB || !env.JWT_SECRET || !env.ENCRYPTION_KEY) return undefined;
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return undefined;
  const token = auth.slice(7);
  try {
    const payload = await verify(token, env.JWT_SECRET);
    if (!payload) return undefined;
    const up = await getUserProviderByUserAndProvider(env.DB, payload.sub, providerType);
    if (!up?.pat) return undefined;
    return decryptSecret(up.pat, env.ENCRYPTION_KEY);
  } catch {
    return undefined;
  }
}

export async function handleSearchRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const type = url.searchParams.get("type") || "docker";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("pageSize") || "25", 10) || 25),
  );

  if (!q.trim()) {
    return makeRes(JSON.stringify({ error: 'query parameter "q" is required' }), 400, {
      "Content-Type": "application/json",
    });
  }

  // 尝试解析用户 PAT（仅对需要认证的 Provider 使用）
  const pat = await resolveUserPat(request, type, env);

  // ---- All: 并发搜索所有 Provider ----
  if (type === "all") {
    const allProviders = getAllProviders();
    const tasks = allProviders.map(async (p) => {
      try {
        const pPat = await resolveUserPat(request, p.id, env);
        const result = await p.doSearch(q, page, pageSize, pPat);
        return { type: p.id, results: result?.results ?? [], total: result?.total ?? 0 };
      } catch {
        return { type: p.id, results: [], total: 0 };
      }
    });
    const settled = await Promise.allSettled(tasks);
    const merged: Record<string, { results: unknown[]; total: number }> = {};
    for (const s of settled) {
      if (s.status === "fulfilled") {
        merged[s.value.type] = { results: s.value.results, total: s.value.total };
      }
    }
    return makeRes(JSON.stringify({ success: true, results: merged }), 200, {
      "Content-Type": "application/json",
    });
  }

  // ---- Single provider ----
  const provider = getProvider(type);
  if (!provider) {
    return makeRes(JSON.stringify({ success: false, error: `unknown search type: ${type}` }), 400, {
      "Content-Type": "application/json",
    });
  }

  const result = await provider.doSearch(q, page, pageSize, pat);
  if (!result) {
    return makeRes(JSON.stringify({ success: false, error: "search failed" }), 500, {
      "Content-Type": "application/json",
    });
  }

  return makeRes(JSON.stringify({ success: true, ...result }), 200, {
    "Content-Type": "application/json",
  });
}
