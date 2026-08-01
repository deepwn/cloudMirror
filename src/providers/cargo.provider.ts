// ============================================================================
// src/providers/cargo.provider.ts — Cargo (crates.io) Provider
// ============================================================================

import { ProviderDefinition } from "./_base";
import type {
  ProviderMeta,
  ProxyConfig,
  SearchConfig,
  ResultMapping,
  ResultCardConfig,
  DetailConfig,
  SetupGuideConfig,
  PopularSearch,
} from "../shared/types";

export class CargoProvider extends ProviderDefinition {
  readonly id = "cargo";
  readonly upstream = "https://crates.io";
  readonly authMode = "none" as const;

  readonly meta: ProviderMeta = {
    id: "cargo",
    name: "Cargo",
    label: "Rust",
    icon: { kind: "simple-icons", name: "siRust" },
    description: "Rust 包注册表镜像加速",
    searchEnabled: true,
    searchLabel: "搜索 Rust crate...",
    searchHint: "cargo add serde --registry cloudmirror",
    setupComponent: "CargoSetup",
    setupFields: [],
    enabled: true,
  };

  // ---- 代理（SDK v2：下载 CDN 路由 + sparse index 转发 + download URL 重写） ----
  readonly proxy: ProxyConfig = {
    defaultUpstream: "https://static.crates.io",
    routes: [
      // sparse index：/api/v1/crates/xxx → index.crates.io/xxx（stripPrefix 剥离前缀，index 为根路径）
      { prefix: "/api/v1/crates/", upstream: "https://index.crates.io", stripPrefix: true },
      // crates.io API（搜索等）
      { prefix: "/api/v1/", upstream: "https://crates.io" },
      // crate 文件下载 CDN（路径含 /crates/ 前缀，原样拼接）
      { prefix: "/crates/", upstream: "https://static.crates.io" },
    ],
    hooks: {
      onBuildRequest: (ctx) => {
        // sparse index 响应需重写 download URL，请求未压缩文本便于处理
        if (new URL(ctx.request.url).pathname.startsWith("/api/v1/crates/")) {
          ctx.headers.delete("Accept-Encoding");
        }
      },
      onSend: async (ctx) => {
        const url = new URL(ctx.request.url);
        if (!url.pathname.startsWith("/api/v1/crates/")) return;
        const res = ctx.response!;
        const text = await res.text();
        // index.crates.io 返回的 download 字段为 https://static.crates.io/... 绝对链接，
        // 重写为 mirror host，保证 crate 文件下载走代理（/crates/ → static.crates.io）
        const rewritten = text.replaceAll("https://static.crates.io", `https://${url.host}`);
        const headers = new Headers(res.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        ctx.response = new Response(rewritten, { status: res.status, headers });
      },
    },
  };

  // ---- 搜索（声明式） ----

  readonly search: SearchConfig = {
    endpoint: "https://crates.io/api/v1/crates",
    pagination: "page",
    pageParam: "page",
    pageSizeParam: "per_page",
  };

  // ---- 配置 ----

  defineResultMapping(): ResultMapping {
    return {
      itemsPath: "crates",
      totalPath: "meta.total",
      itemKind: "package",
      itemIdField: "id",
      fields: {
        title: "name",
        description: "description",
        subtitle: "max_stable_version",
        url: "homepage",
        author: undefined,
        stats: [
          { key: "downloads", path: "downloads", label: "总下载", format: "number" },
          {
            key: "recent_downloads",
            path: "recent_downloads",
            label: "近期下载",
            format: "number",
          },
        ],
      },
    };
  }

  defineResultCard(): ResultCardConfig {
    return {
      titleTemplate: "{title}",
      badges: [{ text: "{subtitle}", variant: "secondary" }],
      descriptionShow: true,
      stats: [{ field: "stats.downloads", label: "下载" }],
      quickCommands: [{ label: "cargo add", template: "cargo add {title} --registry cloudmirror" }],
      detailLink: "/detail?type=cargo&target={id}",
    };
  }

  defineDetail(): DetailConfig {
    return {
      infoEndpoint: "https://crates.io/api/v1/crates/{target}",
      infoMapping: {
        title: "crate.name",
        description: "crate.description",
        author: undefined,
        stats: [
          { label: "最新版本", path: "crate.max_stable_version" },
          { label: "总下载", path: "crate.downloads", type: "number" },
          { label: "近期下载", path: "crate.recent_downloads", type: "number" },
          { label: "许可证", path: "crate.license" },
          { label: "主页", path: "crate.homepage", type: "link" },
          { label: "仓库", path: "crate.repository", type: "link" },
          { label: "文档", path: "crate.documentation", type: "link" },
        ],
      },
      metaFields: { version: "crate.max_stable_version", a: "crate.name" },
      detailUrlTemplate: "https://crates.io/crates/{target}",
      quickConnects: [
        { label: "cargo add", template: "cargo add {target} --registry cloudmirror" },
        { label: "Cargo.toml", template: '{target} = "{version}"' },
      ],
      tabs: [
        {
          id: "readme",
          label: "README",
          icon: { kind: "lucide", name: "BookOpen" },
          type: "markdown",
          dataSource: {
            endpoint: "https://crates.io/api/v1/crates/{target}/readme",
            responseType: "text",
          },
        },
        {
          id: "versions",
          label: "版本列表",
          icon: { kind: "lucide", name: "Tag" },
          type: "table",
          dataSource: {
            endpoint: "https://crates.io/api/v1/crates/{target}/versions",
            responsePath: "versions",
            columns: [
              { field: "num", label: "版本号" },
              { field: "license", label: "许可证", emptyText: "-" },
              { field: "downloads", label: "下载量", format: "number" },
              { field: "created_at", label: "发布时间", format: "date" },
              { field: "yanked", label: "已撤回", emptyText: "否" },
            ],
          },
        },
        {
          id: "dependencies",
          label: "依赖",
          icon: { kind: "lucide", name: "Workflow" },
          type: "keyValue",
          dataSource: {
            endpoint: "https://crates.io/api/v1/crates/{target}/dependencies",
            responsePath: "dependencies",
          },
        },
      ],
    };
  }

  defineSetupGuide(): SetupGuideConfig {
    return {
      summary: "配置 Cargo 使用 cloudMirror 镜像加速 Rust crate 下载。",
      quickCommand: "cargo add serde --registry cloudmirror",
      sections: [
        {
          title: "Cargo 配置",
          items: [
            {
              label: ".cargo/config.toml",
              value:
                '[source.crates-io]\nreplace-with = "cloudmirror"\n\n[source.cloudmirror]\nregistry = "sparse+https://{domain}/api/v1/crates/"',
              mode: "block",
            },
            {
              label: "环境变量 (备选)",
              value: "CARGO_REGISTRIES_CLOUDMIRROR_INDEX=sparse+https://{domain}/api/v1/crates/",
              mode: "block",
            },
          ],
        },
        {
          title: "单次使用",
          items: [
            {
              label: "cargo add",
              value: "cargo add {example} --registry cloudmirror",
              mode: "inline",
            },
            {
              label: "cargo build (使用镜像)",
              value: "cargo build --registry cloudmirror",
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
                "- name: Configure Cargo registry\n  run: |\n    mkdir -p .cargo\n    echo '[source.crates-io]' >> .cargo/config.toml\n    echo 'replace-with = \"cloudmirror\"' >> .cargo/config.toml\n    echo '' >> .cargo/config.toml\n    echo '[source.cloudmirror]' >> .cargo/config.toml\n    echo 'registry = \"sparse+https://{domain}/api/v1/crates/\"' >> .cargo/config.toml",
              mode: "block",
            },
          ],
        },
      ],
    };
  }

  definePopularSearches(): PopularSearch[] {
    return [
      { name: "serde", description: "序列化/反序列化框架" },
      { name: "tokio", description: "异步运行时" },
      { name: "clap", description: "CLI 参数解析" },
      { name: "reqwest", description: "HTTP 客户端" },
      { name: "actix-web", description: "Web 框架" },
    ];
  }
}

export const cargoProvider = new CargoProvider();
