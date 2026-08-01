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
        const repoMatch = url.pathname.match(/^\/v2\/(.+?)(?:\/(?:manifests|blobs|tags)\/|$)/);
        const repo = repoMatch ? repoMatch[1] : null;

        // Docker Token 交换（basic 凭据 → registry Bearer）
        let authHeader: string | null = null;
        if (ctx.route.pat && repo) {
          try {
            const tokenUrl = new URL("https://auth.docker.io/token");
            tokenUrl.searchParams.set("service", "registry.docker.io");
            tokenUrl.searchParams.set("scope", `repository:${repo}:pull`);

            const user = ctx.route.patUsername || "token";
            const id = btoa(user + ":" + ctx.route.pat);
            const tokenRes = await fetch(tokenUrl.toString(), {
              headers: { Authorization: `Basic ${id}`, Accept: "application/json" },
            });
            if (tokenRes.ok) {
              const td = (await tokenRes.json()) as { token?: string; access_token?: string };
              const t = td.token || td.access_token;
              if (t) authHeader = `Bearer ${t}`;
            }
          } catch (err) {
            console.error("[docker] token exchange failed:", (err as Error).message);
          }
        }

        ctx.headers.set("Host", this.upstream.replace("https://", ""));
        ctx.headers.set("User-Agent", ctx.request.headers.get("User-Agent") || "docker/27.0.0");
        // 覆盖默认 Bearer PAT 注入：docker 需要 basic 交换后的 token
        ctx.headers.delete("Authorization");
        if (authHeader) ctx.headers.set("Authorization", authHeader);
      },
      onSend: (ctx) => {
        const out = ctx.response!.headers;
        const loc = out.get("Location");
        if (loc) {
          out.set(
            "Location",
            loc.replace(
              /https:\/\/registry-1\.docker\.io/g,
              `https://${new URL(ctx.request.url).host}`,
            ),
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
