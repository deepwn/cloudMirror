// ============================================================================
// src/worker/api/detail.ts — v1.0: 统一详情 API
// ============================================================================
// GET /api/v1/detail?type=xxx&target=xxx
// 由 Provider.getDetail() 服务端一次性获取 info + tabs 数据，前端无需多次 fetchProxy
// ============================================================================

import { makeRes } from "../config";
import type { Env } from "../providers/types";
import { getProvider } from "../../providers/registry";

export async function handleDetailRoute(request: Request, _env: Env): Promise<Response> {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "";
  const target = url.searchParams.get("target") || "";

  if (!type) {
    return makeRes(JSON.stringify({ error: "type is required" }), 400, {
      "Content-Type": "application/json",
    });
  }
  if (!target) {
    return makeRes(JSON.stringify({ error: "target is required" }), 400, {
      "Content-Type": "application/json",
    });
  }

  const provider = getProvider(type);
  if (!provider) {
    return makeRes(JSON.stringify({ error: `unknown provider type: ${type}` }), 400, {
      "Content-Type": "application/json",
    });
  }

  const detail = await provider.getDetail(target);
  if (!detail) {
    return makeRes(JSON.stringify({ error: "detail not found" }), 404, {
      "Content-Type": "application/json",
    });
  }

  return makeRes(JSON.stringify({ success: true, ...detail }), 200, {
    "Content-Type": "application/json",
  });
}
