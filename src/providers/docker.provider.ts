// ============================================================================
// src/providers/docker.provider.ts — Docker Hub Provider
// ============================================================================

import { ProviderDefinition } from "./_base";
import type {
  ProviderMeta,
  ProxyConfig,
  ResultMapping,
  ResultCardConfig,
  DetailConfig,
  SetupGuideConfig,
  PopularSearch,
  GenericSearchResponse,
} from "../shared/types";

// Docker Token 交换结果缓存（Cache API，按 repo + PAT 指纹，TTL 5min）。
// 一个镜像拉取包含 manifests + N 个 blob 请求，若每个请求都向 auth.docker.io
// 重新交换，会快速耗尽 PAT 配额（5000/hr）且显著增加延迟。
const TOKEN_CACHE_TTL = 300;

function dockerTokenCacheKey(repo: string, patFingerprint: string): string {
  return `https://internal.cloudmirror/docker-token/${encodeURIComponent(repo)}/${patFingerprint}`;
}

function getTokenCache(): Cache | undefined {
  try {
    return (caches as unknown as { default?: Cache })?.default;
  } catch {
    return undefined;
  }
}

async function getCachedToken(
  repo: string,
  patFingerprint: string,
): Promise<string | null> {
  const cache = getTokenCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(dockerTokenCacheKey(repo, patFingerprint));
    if (!hit) return null;
    const data = (await hit.json()) as { token?: string };
    return data.token ?? null;
  } catch {
    return null;
  }
}

async function setCachedToken(
  repo: string,
  patFingerprint: string,
  token: string,
): Promise<void> {
  const cache = getTokenCache();
  if (!cache) return;
  try {
    const res = new Response(JSON.stringify({ token }), {
      headers: { "Cache-Control": `max-age=${TOKEN_CACHE_TTL}` },
    });
    await cache.put(dockerTokenCacheKey(repo, patFingerprint), res);
  } catch {
    // 缓存不可用时忽略（降级为每次交换）
  }
}

export class DockerHubProvider extends ProviderDefinition {
  readonly id = "docker";
  readonly upstream = "https://registry-1.docker.io";
  readonly authMode = "basic" as const;

  readonly meta: ProviderMeta = {
    id: "docker",
    name: "Docker Hub",
    label: "Docker",
    icon: { kind: "simple-icons", name: "siDocker", colored: true },
    description: "容器镜像代理，突破 Docker Hub 速率限制",
    searchEnabled: true,
    searchLabel: "搜索 Docker 镜像...",
    searchHint: "docker pull {hash}.mirror.example.com/library/nginx:latest",
    setupComponent: "DockerSetup",
    setupFields: [],
    enabled: true,
  };

  // ---- 代理（SDK v2：Token 交换走 onBuildRequest，Location 重写走 onSend，见 docs §5.3.1） ----

  readonly proxy: ProxyConfig = {
    exposeHeaders: true,
    hooks: {
      onBuildRequest: async (ctx) => {
        const url = new URL(ctx.request.url);
        const path = url.pathname;

        // 1) 客户端 Token 请求（401 挑战的 realm 已被 onSend 重写指向本 mirror）：
        //    透传到 auth.docker.io，并按需注入 Basic PAT，保证 token 流量也走 worker。
        if (path === "/token" || path.startsWith("/token/")) {
          // 补全 scope 中单段镜像名（repository:neo4j:pull → repository:library/neo4j:pull），
          // 否则 auth.docker.io 会拒绝非规范仓库名的匿名/PAT 签发。
          const scope = url.searchParams.get("scope");
          if (scope) {
            const parts = scope.split(":");
            if (parts.length === 3 && parts[0] === "repository" && !parts[1].includes("/")) {
              parts[1] = "library/" + parts[1];
              url.searchParams.set("scope", parts.join(":"));
            }
          }
          ctx.target = "https://auth.docker.io/token" + url.search;
          ctx.headers.set("Host", "auth.docker.io");
          ctx.headers.delete("Authorization");
          if (ctx.route.pat) {
            const user = ctx.route.patUsername || "token";
            ctx.headers.set("Authorization", `Basic ${btoa(user + ":" + ctx.route.pat)}`);
          }
          return;
        }

        // 2) Docker Hub 单段镜像名自动补全 library/（/v2/nginx/... → /v2/library/nginx/...）
        const singleSeg = path.match(/^\/v2\/([^/]+)(?=\/(?:manifests|blobs|tags)\/|$)/);
        if (singleSeg && !singleSeg[1].startsWith("library/")) {
          ctx.target = ctx.target.replace(
            /\/v2\/[^/]+(?=\/(?:manifests|blobs|tags)\/|$)/,
            `/v2/library/${singleSeg[1]}`,
          );
        }

        // 3) Docker Token 交换（basic 凭据 → registry Bearer）
        const repoMatch = new URL(ctx.target).pathname.match(
          /^\/v2\/(.+?)(?:\/(?:manifests|blobs|tags)\/|$)/,
        );
        const repo = repoMatch ? repoMatch[1] : null;
        const clientAuth = ctx.request.headers.get("Authorization");

        // ---- 诊断埋点（暴露为 X-Cf-Debug-Auth，供真实 CLI/审计观测 auth 链路） ----
        ctx.debug = {
          pat: ctx.route.pat ? "yes" : "no",
          client: clientAuth ? clientAuth.split(" ")[0] || "auth" : "none",
        };

        let authHeader: string | null = null;
        if (ctx.route.pat && repo) {
          const user = ctx.route.patUsername || "token";
          const patFingerprint = ctx.route.pat.slice(-8);
          try {
            // 缓存命中 → 复用已交换 token，避免每个 blob 请求重复交换
            const cached = await getCachedToken(repo, patFingerprint);
            ctx.debug!.cache = cached ? "hit" : "miss";
            if (cached) {
              authHeader = `Bearer ${cached}`;
              ctx.debug!.auth = "cache";
            } else {
              const tokenUrl = new URL("https://auth.docker.io/token");
              tokenUrl.searchParams.set("service", "registry.docker.io");
              tokenUrl.searchParams.set("scope", `repository:${repo}:pull`);
              tokenUrl.searchParams.set("offline_token", "true");

              const id = btoa(user + ":" + ctx.route.pat);
              const tokenRes = await fetch(tokenUrl.toString(), {
                headers: { Authorization: `Basic ${id}`, Accept: "application/json" },
              });
              if (tokenRes.ok) {
                const td = (await tokenRes.json()) as {
                  token?: string;
                  access_token?: string;
                };
                const t = td.token || td.access_token;
                if (t) {
                  authHeader = `Bearer ${t}`;
                  await setCachedToken(repo, patFingerprint, t);
                  ctx.debug!.auth = "exchange";
                } else {
                  ctx.debug!.auth = "exchange-empty";
                }
              } else {
                ctx.debug!.auth = `exchange-http-${tokenRes.status}`;
                console.error(`[docker] token exchange HTTP ${tokenRes.status}`);
              }
            }
          } catch (err) {
            ctx.debug!.auth = "exchange-error";
            console.error("[docker] token exchange failed:", (err as Error).message);
          }
        } else {
          ctx.debug!.auth = ctx.route.pat ? "no-repo" : "no-pat";
          ctx.debug!.cache = "n/a";
        }

        ctx.headers.set("Host", this.upstream.replace("https://", ""));
        ctx.headers.set("User-Agent", ctx.request.headers.get("User-Agent") || "docker/27.0.0");
        // 覆盖默认 Bearer PAT 注入：docker 需要 basic 交换后的 token。
        // 交换成功 → 用服务端 token；交换失败 → 保留客户端自带 Authorization 作 fallback。
        ctx.headers.delete("Authorization");
        if (authHeader) {
          ctx.headers.set("Authorization", authHeader);
          ctx.debug!.final = "server";
        } else if (clientAuth) {
          ctx.headers.set("Authorization", clientAuth);
          ctx.debug!.final = "client";
        } else {
          ctx.debug!.final = "none";
        }
        console.log(
          `[docker] path=${path} repo=${repo ?? "-"} pat=${ctx.route.pat ? "yes" : "no"} ` +
            `clientAuth=${clientAuth ? clientAuth.slice(0, 20) + "..." : "none"} ` +
            `authHeader=${authHeader ? "yes" : "no"} ` +
            `finalAuth=${ctx.headers.get("Authorization") ? ctx.headers.get("Authorization")!.slice(0, 20) + "..." : "none"} ` +
            `debug=${JSON.stringify(ctx.debug)}`,
        );
      },
      onSend: (ctx) => {
        const out = ctx.response!.headers;
        const mirrorHost = new URL(ctx.request.url).host;
        const loc = out.get("Location");
        if (loc) {
          out.set(
            "Location",
            loc.replace(/https:\/\/registry-1\.docker\.io/g, `https://${mirrorHost}`),
          );
        }
        // 401 挑战的 realm 重写为本 mirror：客户端 token 请求必须回到 worker，
        // 否则直连 auth.docker.io（PAT 失效，私有镜像 401）。
        const wa = out.get("WWW-Authenticate");
        if (wa) {
          out.set(
            "WWW-Authenticate",
            wa.replace(/https:\/\/auth\.docker\.io/g, `https://${mirrorHost}`),
          );
        }
        // 诊断：对 401/429 响应暴露 auth 链路（PAT/交换/最终来源），供真实 CLI 与调试观测。
        if (ctx.debug && (ctx.response!.status === 401 || ctx.response!.status === 429)) {
          out.set(
            "X-Cf-Debug-Auth",
            Object.entries(ctx.debug)
              .map(([k, v]) => `${k}=${v}`)
              .join(","),
          );
        }
        out.delete("content-security-policy-report-only");
      },
    },
  };

  // ---- 搜索 ----

  async doSearch(
    query: string,
    page: number,
    pageSize: number,
    _pat?: string,
  ): Promise<GenericSearchResponse | null> {
    const uaList = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
    ];

    // v1 search first, then v3 content API as fallback
    for (const ua of uaList) {
      const v1Url = `https://index.docker.io/v1/search?q=${encodeURIComponent(query)}&n=${pageSize}&page=${page}`;
      try {
        const res = await fetch(v1Url, {
          headers: { "User-Agent": ua, Accept: "application/json" },
        });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          results?: Array<{
            name?: string;
            description?: string;
            star_count?: number | string;
            pull_count?: number | string;
            is_official?: boolean;
            is_trusted?: boolean;
          }>;
          num_results?: number;
        };
        if (data?.results) {
          const results = data.results.map((r) => ({
            kind: "image" as const,
            name: r.name || "",
            short_description: r.description || "",
            star_count: Number(r.star_count) || 0,
            pull_count: Number(r.pull_count) || 0,
            is_official: !!r.is_official,
            is_verified_publisher: !!r.is_trusted,
            publisher_type: (r.is_official ? "official" : r.is_trusted ? "verified" : undefined) as
              | string
              | undefined,
          }));
          const total = data.num_results ?? results.length;
          return {
            results: results.map((raw: unknown) => this.mapSearchItem(raw)),
            total,
            page,
            pageSize,
          };
        }
      } catch {
        /* fallback */
      }
    }

    // v3 content API fallback
    for (const ua of uaList) {
      const cUrl = `https://hub.docker.com/api/content/v1/products/search?q=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}&type=image`;
      try {
        const res = await fetch(cUrl, {
          headers: { "User-Agent": ua, Accept: "application/json", "Search-Version": "v3" },
        });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          summaries?: Array<{
            name?: string;
            short_description?: string;
            star_count?: number | string;
            pull_count?: number | string;
            is_official?: boolean;
            is_verified_publisher?: boolean;
          }>;
          count?: number;
        };
        if (data?.summaries) {
          const results = data.summaries.map((r) => ({
            kind: "image" as const,
            name: r.name || "",
            short_description: r.short_description || "",
            star_count: Number(r.star_count) || 0,
            pull_count: Number(r.pull_count) || 0,
            is_official: !!r.is_official,
            is_verified_publisher: !!r.is_verified_publisher,
            publisher_type: (r.is_official
              ? "official"
              : r.is_verified_publisher
                ? "verified"
                : undefined) as string | undefined,
          }));
          const total = data.count ?? results.length;
          return {
            results: results.map((raw: unknown) => this.mapSearchItem(raw)),
            total,
            page,
            pageSize,
          };
        }
      } catch {
        /* fallback */
      }
    }

    return null;
  }

  // ---- 配置 ----

  defineResultMapping(): ResultMapping {
    return {
      itemsPath: "results",
      totalPath: "total",
      itemKind: "image",
      itemIdField: "name",
      fields: {
        title: "name",
        description: "short_description",
        author: "publisher_type",
        stats: [
          { key: "stars", path: "star_count", label: "Stars", format: "number" },
          { key: "pulls", path: "pull_count", label: "Pulls", format: "number" },
        ],
      },
    };
  }

  defineResultCard(): ResultCardConfig {
    return {
      titleTemplate: "{title}",
      badges: [
        {
          text: "官方",
          variant: "default",
          condition: { field: "raw.is_official", operator: "eq", value: true },
        },
        {
          text: "已验证",
          variant: "secondary",
          condition: { field: "raw.is_verified_publisher", operator: "eq", value: true },
        },
      ],
      descriptionShow: true,
      stats: [
        { field: "stats.stars", label: "Stars" },
        { field: "stats.pulls", label: "Pulls" },
      ],
      quickCommands: [
        { label: "docker pull", template: "docker pull {domain}/{title}" },
        { label: "podman pull", template: "podman pull {domain}/{title}" },
      ],
      detailLink: "/detail?type=docker&target={id}",
    };
  }

  defineDetail(): DetailConfig {
    return {
      infoEndpoint: "https://hub.docker.com/v2/repositories/{target}",
      infoMapping: {
        title: "name",
        description: "description",
        author: "namespace",
        stats: [
          { label: "Stars", path: "star_count" },
          { label: "Pulls", path: "pull_count" },
          { label: "命名空间类型", path: "namespace_type" },
        ],
      },
      metaFields: { a: "name" },
      detailUrlTemplate: "https://hub.docker.com/r/{target}",
      tabs: [
        {
          id: "readme",
          label: "README",
          icon: { kind: "lucide", name: "BookOpen" },
          type: "markdown",
          dataSource: {
            endpoint: "https://hub.docker.com/v2/repositories/{target}",
            responsePath: "full_description",
          },
        },
        {
          id: "tags",
          label: "Tags",
          icon: { kind: "lucide", name: "Tag" },
          type: "table",
          dataSource: {
            endpoint: "https://hub.docker.com/v2/repositories/{target}/tags",
            responsePath: "results",
            columns: [
              { field: "name", label: "Tag" },
              { field: "images[0].architecture", label: "架构" },
              { field: "full_size", label: "大小", format: "bytes" },
              { field: "last_updated", label: "更新时间", format: "date" },
            ],
          },
        },
      ],
    };
  }

  // ---- 覆写 resolveDetailTarget：Docker Hub API 需要完整路径 library/xxx ----

  protected resolveDetailTarget(target: string): string {
    return target.includes("/") ? target : `library/${target}`;
  }

  defineSetupGuide(): SetupGuideConfig {
    return {
      summary: "面向 Docker、Podman、containerd 与 Kubernetes 的全局镜像加速。",
      quickCommand: "docker pull {domain}/library/nginx:latest",
      sections: [
        {
          title: "Docker 全局镜像源",
          items: [
            {
              label: "daemon.json",
              value: `{\n  "registry-mirrors": ["https://{domain}"]\n}`,
              mode: "block",
            },
            {
              label: "重启 Docker",
              value:
                "systemctl restart docker  # Linux\n# 或 Docker Desktop → Settings → Docker Engine → Apply & Restart",
              mode: "block",
            },
            {
              label: "验证拉取",
              value: "docker pull {domain}/library/nginx:latest",
              mode: "inline",
            },
            {
              label: "docker info 检查",
              value: 'docker info | grep -A5 "Registry Mirrors"',
              mode: "inline",
            },
          ],
        },
        {
          title: "Podman",
          items: [
            {
              label: "registries.conf",
              value: `[[registry]]\nlocation = "docker.io"\n\n[[registry.mirror]]\nlocation = "{domain}"`,
              mode: "block",
            },
          ],
        },
        {
          title: "containerd / Kubernetes",
          items: [
            {
              label: "containerd config.toml",
              value:
                '[plugins."io.containerd.grpc.v1.cri".registry.mirrors."docker.io"]\n  endpoint = ["https://{domain}"]',
              mode: "block",
            },
            {
              label: "nerdctl 验证",
              value: "nerdctl pull {domain}/library/nginx:latest",
              mode: "inline",
            },
          ],
        },
        {
          title: "CI/CD 配置",
          items: [
            {
              label: "GitHub Actions",
              value:
                '- name: Set up Docker mirror\n  run: |\n    echo \'{ "registry-mirrors": ["https://{domain}"] }\' | sudo tee /etc/docker/daemon.json\n    sudo systemctl restart docker',
              mode: "block",
            },
          ],
        },
      ],
    };
  }

  defineCredentialTypes() {
    return [
      { value: "docker", label: "docker", authMode: "basic" as const },
      { value: "ghcr", label: "ghcr", authMode: "bearer" as const },
      { value: "gcr", label: "gcr", authMode: "basic" as const },
      { value: "quay", label: "quay", authMode: "basic" as const },
      { value: "k8s", label: "k8s", authMode: "basic" as const },
      { value: "nvcr", label: "nvcr", authMode: "basic" as const },
    ];
  }

  definePopularSearches(): PopularSearch[] {
    return [
      { name: "nginx", description: "高性能 Web 服务器" },
      { name: "redis", description: "内存数据库" },
      { name: "node", description: "Node.js 运行时" },
      { name: "python", description: "Python 运行时" },
    ];
  }
}

export const dockerProvider = new DockerHubProvider();
