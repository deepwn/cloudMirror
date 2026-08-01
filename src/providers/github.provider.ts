// ============================================================================
// src/providers/github.provider.ts — GitHub Provider
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

export class GitHubProvider extends ProviderDefinition {
  readonly id = "github";
  readonly upstream = "https://github.com";
  readonly authMode = "bearer" as const;

  readonly meta: ProviderMeta = {
    id: "github",
    name: "GitHub",
    icon: { kind: "simple-icons", name: "siGithub" },
    description: "GitHub 仓库、Release、Raw 文件、Git LFS 大文件与 Git 克隆加速",
    searchEnabled: true,
    searchLabel: "搜索 GitHub 仓库...",
    searchHint: "git clone https://{hash}.mirror.example.com/user/repo.git",
    setupComponent: "GitHubSetup",
    setupFields: [],
    enabled: true,
  };

  // ---- 代理（SDK v2：路由表 + hooks，见 docs §5.3.1） ----
  readonly proxy: ProxyConfig = {
    routes: [
      // raw 文件：/raw/user/repo/main/file → raw.githubusercontent.com/user/repo/main/file（剥离 /raw/）
      { prefix: "/raw/", upstream: "https://raw.githubusercontent.com", stripPrefix: true },
      // API：/api/repos/... → api.github.com/repos/...（剥离 /api/）
      { prefix: "/api/", upstream: "https://api.github.com", stripPrefix: true },
      // repos API 直通：/repos/... → api.github.com/repos/...（路径一致，原样拼接）
      { prefix: "/repos/", upstream: "https://api.github.com" },
    ],
    exposeHeaders: true,
    hooks: {
      onBuildRequest: (ctx) => {
        ctx.headers.set(
          "Accept",
          ctx.target.includes("/info/lfs")
            ? "application/vnd.git-lfs+json"
            : "application/vnd.github.v3+json",
        );
      },
    },
  };

  // ---- 搜索 ----

  async doSearch(
    query: string,
    page: number,
    pageSize: number,
    pat?: string,
  ): Promise<GenericSearchResponse | null> {
    const searchQ =
      query.includes("user:") || query.includes("org:") || query.includes("repo:")
        ? query
        : `${query} in:name,description,topics`;

    const params = new URLSearchParams({
      q: searchQ,
      sort: "stars",
      order: "desc",
      per_page: String(Math.min(pageSize, 100)),
      page: String(page),
    });

    const headers: Record<string, string> = {
      "User-Agent": "CloudMirror/4.0",
      Accept: "application/vnd.github.v3+json",
    };
    if (pat) headers["Authorization"] = `Bearer ${pat}`;

    const res = await fetch(`https://api.github.com/search/repositories?${params}`, { headers });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      items?: Array<{
        full_name?: string;
        description?: string;
        stargazers_count?: number;
        forks_count?: number;
        language?: string;
        clone_url?: string;
        html_url?: string;
        updated_at?: string;
      }>;
      total_count?: number;
    };

    const items = data.items ?? [];
    const total = Math.min(data.total_count ?? 0, 1000);

    // Map items to format expected by defineResultMapping
    const mapped = items.map((raw) => ({
      kind: "repo" as const,
      name: raw.full_name || "",
      full_name: raw.full_name || "",
      description: raw.description || "",
      stars: raw.stargazers_count || 0,
      forks: raw.forks_count || 0,
      language: raw.language || "",
      clone_url: raw.clone_url || "",
      html_url: raw.html_url || "",
      updated_at: raw.updated_at || "",
    }));

    return {
      results: mapped.map((raw: unknown) => this.mapSearchItem(raw)),
      total,
      page,
      pageSize,
    };
  }

  // ---- 配置 ----

  defineResultMapping(): ResultMapping {
    return {
      itemsPath: "items",
      totalPath: "total",
      itemKind: "repo",
      itemIdField: "name",
      fields: {
        title: "full_name",
        description: "description",
        author: "name",
        stats: [
          { key: "stars", path: "stars", label: "Stars", format: "number" },
          { key: "forks", path: "forks", label: "Forks", format: "number" },
        ],
      },
    };
  }

  defineResultCard(): ResultCardConfig {
    return {
      titleTemplate: "{title}",
      badges: [],
      descriptionShow: true,
      stats: [
        { field: "stats.stars", label: "Stars" },
        { field: "stats.forks", label: "Forks" },
      ],
      quickCommands: [{ label: "git clone", template: "git clone https://{domain}/{title}.git" }],
      detailLink: "/detail?type=github&target={id}",
    };
  }

  defineDetail(): DetailConfig {
    return {
      infoEndpoint: "https://api.github.com/repos/{target}",
      infoMapping: {
        title: "full_name",
        description: "description",
        author: "owner?.login",
        stats: [
          { label: "Stars", path: "stargazers_count" },
          { label: "Forks", path: "forks_count" },
          { label: "语言", path: "language" },
          { label: "开源协议", path: "license?.spdx_id" },
        ],
      },
      metaFields: { a: "full_name" },
      detailUrlTemplate: "https://github.com/{target}",
      quickConnects: [{ label: "git clone", template: "git clone https://{domain}/{target}.git" }],
      tabs: [
        {
          id: "readme",
          label: "README",
          icon: { kind: "lucide", name: "BookOpen" },
          type: "markdown",
          dataSource: {
            endpoint: "https://api.github.com/repos/{target}/readme",
            responseType: "json",
            decode: "base64",
            // README 相对图片基于默认分支 raw 路径（后端内嵌为 data URL）
            docBase: "https://raw.githubusercontent.com/{target}/HEAD/",
          },
        },
        {
          id: "releases",
          label: "Releases",
          icon: { kind: "lucide", name: "Package" },
          type: "releases",
          dataSource: {
            endpoint: "https://api.github.com/repos/{target}/releases?per_page=20",
          },
        },
      ],
    };
  }

  defineSetupGuide(): SetupGuideConfig {
    return {
      summary: "GitHub 仓库、Release、Raw 文件与 Git LFS 大文件加速。",
      quickCommand: 'git config --global url."https://{domain}/".insteadOf https://github.com/',
      sections: [
        {
          title: "全局加速 (推荐)",
          items: [
            {
              label: "git insteadOf",
              value: 'git config --global url."https://{domain}/".insteadOf https://github.com/',
              mode: "block",
            },
            {
              label: "取消设置",
              value: 'git config --global --unset url."https://{domain}/".insteadOf',
              mode: "inline",
            },
          ],
        },
        {
          title: "Git Clone",
          items: [
            { label: "直接克隆", value: "git clone https://{domain}/user/repo.git", mode: "block" },
            {
              label: "浅克隆 (加速)",
              value: "git clone --depth 1 https://{domain}/user/repo.git",
              mode: "inline",
            },
            {
              label: "子模块加速",
              value:
                'git config --global url."https://{domain}/".insteadOf https://github.com/\ngit submodule update --init --recursive',
              mode: "block",
            },
          ],
        },
        {
          title: "Git LFS (大文件)",
          items: [
            {
              label: "克隆含 LFS 文件",
              value: "git lfs clone https://{domain}/user/repo.git",
              mode: "block",
            },
            { label: "单独拉取 LFS", value: "cd repo && git lfs fetch --all", mode: "inline" },
            {
              label: "CI 跳过 LFS (加速)",
              value: "GIT_LFS_SKIP_SMUDGE=1 git clone https://{domain}/user/repo.git",
              mode: "block",
            },
          ],
        },
        {
          title: "Raw 文件",
          items: [
            {
              label: "下载 Raw 文件",
              value: "wget https://{domain}/raw/user/repo/main/file",
              mode: "inline",
            },
            {
              label: "curl 下载",
              value: "curl -O https://{domain}/raw/user/repo/main/file",
              mode: "inline",
            },
          ],
        },
        {
          title: "Release 下载",
          items: [
            {
              label: "下载 Release 资源",
              value: "wget https://{domain}/releases/user/repo/download/v1.0/file.tar.gz",
              mode: "inline",
            },
            {
              label: "Release 列表 API",
              value: "curl https://{domain}/api/repos/user/repo/releases/latest",
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
                '- name: Configure Git mirror\n  run: git config --global url."https://{domain}/".insteadOf https://github.com/',
              mode: "block",
            },
            {
              label: "Dockerfile",
              value:
                'RUN git config --global url."https://{domain}/".insteadOf https://github.com/',
              mode: "block",
            },
          ],
        },
      ],
    };
  }

  defineCredentialTypes() {
    return [{ value: "github", label: "GitHub", authMode: "bearer" as const }];
  }

  definePopularSearches(): PopularSearch[] {
    return [
      { name: "facebook/react", description: "UI 库" },
      { name: "torvalds/linux", description: "Linux 内核" },
      { name: "microsoft/vscode", description: "代码编辑器" },
    ];
  }
}

export const githubProvider = new GitHubProvider();
