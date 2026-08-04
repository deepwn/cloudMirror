// ============================================================================
// src/worker/api/index.ts — v1.0: API 路由分发（SDK v2: /cloudmirror-api/v1/*）
// ============================================================================

import type { Env } from "../providers/types";
import { makeRes } from "../config";
import { handleAuthRoute } from "./auth";
import { handleSearchRoute } from "./search";
import { handleCredentialRoute } from "./credentials";
import { handleDashboardRoute } from "./dashboard";
import { handleAdminRoute } from "./admin";
import { handleProviderRoute } from "./providers";
import { handleFetchRoute } from "./fetch";
import { handleDebugFetchRoute } from "./debug";
import { handleDetailRoute } from "./detail";
import { handleCaptureRoute } from "./capture";
import { getAllMetas } from "../../providers/registry";
import { PLATFORM_API_PREFIX, platformApi } from "../../shared/api";
import { DEFAULT_APP_DOMAIN } from "../config";

/** API 路由分发入口。匹配 /cloudmirror-api/v1/* 路径。 */
export async function handleApi(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(PLATFORM_API_PREFIX, "");

  switch (true) {
    case path === "/health":
      return makeRes(JSON.stringify({ status: "ok", version: "4.0.0" }), 200, {
        "Content-Type": "application/json",
      });

    case path.startsWith("/auth/"): {
      const action = path.replace("/auth/", "").split("/")[0];
      return handleAuthRoute(request, env, action);
    }

    case path === "/search" || path.startsWith("/search?"):
      return handleSearchRoute(request, env);

    case path === "/detail" || path.startsWith("/detail?"):
      return handleDetailRoute(request, env);

    case path.startsWith("/providers"):
      return handleProviderRoute(request, env, path);

    case path.startsWith("/credentials"):
      return handleCredentialRoute(request, env, path.replace("/credentials", ""));

    case path.startsWith("/dashboard"):
      return handleDashboardRoute(request, env, path.replace("/dashboard", ""));

    case path.startsWith("/admin"):
      return handleAdminRoute(request, env, path.replace("/admin", ""));

    case path.startsWith("/fetch"):
      return handleFetchRoute(request, env);

    case path === "/debug-fetch":
      return handleDebugFetchRoute(request, env);

    case path.startsWith("/capture"):
      return handleCaptureRoute(request, env, path);

    case path === "/site-info":
      return makeRes(
        JSON.stringify({
          name: "cloudMirror",
          version: "1.0.0",
          domain: env.APP_DOMAIN ?? DEFAULT_APP_DOMAIN,
          // searchApi / route 由 platformApi() 统一派生，Provider 不再手写（SDK v2）
          providers: getAllMetas().map((m) => ({
            ...m,
            searchApi: platformApi(`/search?type=${m.id}`),
            route: platformApi(`/detail?type=${m.id}`),
          })),
          notice: "",
        }),
        200,
        { "Content-Type": "application/json" },
      );

    default:
      return makeRes(JSON.stringify({ error: "Not Found" }), 404, {
        "Content-Type": "application/json",
      });
  }
}
