// ============================================================================
// src/providers/dart.provider.ts — Dart (pub.dev) Provider
// ============================================================================

import { ProviderDefinition } from "./_base";
import { fetchRepositoryReadme } from "./utils/fetch-readme";
import { getByPath } from "../shared/utils/json-path";
import type {
  ProviderMeta,
  ResultMapping, ResultCardConfig, DetailConfig, SetupGuideConfig, PopularSearch,
  GenericSearchResponse,
} from "../shared/types";

export class DartProvider extends ProviderDefinition {
  readonly id = "dart";
  readonly upstream = "https://pub.dev";
  readonly authMode = "none" as const;

  readonly meta: ProviderMeta = {
    id: "dart", name: "Dart Packages", label: "Dart",
    icon: { kind: "simple-icons", name: "siDart", colored: true },
    description: "Dart 包注册表镜像加速",
    searchEnabled: true, searchLabel: "搜索 Dart 包...",
    searchHint: "dart pub add package_name",
    setupComponent: "dartSetup", setupFields: [],
    enabled: true,
  };

  // ---- 搜索 ----

  async doSearch(query: string, page: number, pageSize: number, _pat?: string): Promise<GenericSearchResponse | null> {
    // pub.dev 搜索端点是 /api/search，返回 { packages: [{package}], next }。
    // /api/packages 的 q 参数会被忽略（返回默认包列表），不能用于搜索。
    const url = new URL("https://pub.dev/api/search");
    url.searchParams.set("q", query);
    url.searchParams.set("page", String(page));

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json() as { packages?: { package?: string }[]; next?: string | null };

    const rawNames = (data.packages ?? []).map((p) => String(p.package ?? "")).filter(Boolean);
    const hasNext = Boolean(data.next);
    // pub.dev search 不返回 total，用 next 推断：还有下一页则至少 page*pageSize，否则为当前累计
    const total = hasNext ? page * pageSize : (page - 1) * pageSize + rawNames.length;

    // 并发获取每个包的详情（version / description / homepage）
    const packages: { name: string; version: string; description: string; homepage: string; likes: number; downloads: number }[] = await Promise.all(
      rawNames.map(async (name) => {
        try {
          const dRes = await fetch(`https://pub.dev/api/packages/${encodeURIComponent(name)}`);
          if (dRes.ok) {
            const d = await dRes.json() as Record<string, unknown>;
            const latest = (d.latest as Record<string, unknown>) ?? {};
            const pubspec = (latest.pubspec as Record<string, unknown>) ?? {};
            return {
              name: String(d.name ?? name),
              version: String(latest.version ?? ""),
              description: String(pubspec.description ?? ""),
              homepage: String(pubspec.homepage ?? ""),
              likes: 0,
              downloads: 0,
            };
          }
        } catch { /* detail fetch failed */ }
        return { name, version: "", description: "", homepage: "", likes: 0, downloads: 0 };
      }),
    );

    // 并发获取每个包 /score 端点的 likes/downloads
    await Promise.all(
      packages.map(async (pkg) => {
        try {
          const res = await fetch(`https://pub.dev/api/packages/${encodeURIComponent(pkg.name)}/score`);
          if (res.ok) {
            const s = await res.json() as { likeCount?: number; downloadCount30Days?: number };
            pkg.likes = s.likeCount ?? 0;
            pkg.downloads = s.downloadCount30Days ?? 0;
          }
        } catch { /* score fetch failed, keep 0 */ }
      }),
    );

    const items = packages.slice(0, pageSize).map((raw: unknown) => this.mapSearchItem(raw));

    return { results: items, total, page, pageSize };
  }

  // ---- 配置 ----

  defineResultMapping(): ResultMapping {
    return {
      itemsPath: "packages", totalPath: "total",
      itemKind: "package", itemIdField: "name",
      fields: {
        title: "name", description: "description",
        subtitle: "version",
        url: "homepage",
        stats: [
          { key: "likes", path: "likes", label: "Likes", format: "number" },
          { key: "downloads", path: "downloads", label: "月下载", format: "number" },
        ],
      },
    };
  }

  defineResultCard(): ResultCardConfig {
    return {
      titleTemplate: "{title}",
      badges: [{ text: "{subtitle}", variant: "secondary" }],
      descriptionShow: true,
      stats: [{ field: "stats.likes", label: "Likes" }, { field: "stats.downloads", label: "下载" }],
      quickCommands: [
        { label: "dart pub add",
          template: "dart pub add {title}" },
      ],
      detailLink: "/detail?type=dart&target={id}",
    };
  }

  defineDetail(): DetailConfig {
    return {
      infoEndpoint: "https://pub.dev/api/packages/{target}",
      infoMapping: {
        title: "name", description: "latest.pubspec.description",
        stats: [
          { label: "版本", path: "latest.version" },
          { label: "Likes", path: "score.likeCount" },
          { label: "月下载", path: "score.downloadCount30Days" },
        ],
      },
      metaFields: { version: "latest.version", a: "name" },
      detailUrlTemplate: "https://pub.dev/packages/{target}",
      quickConnects: [
        { label: "PUB_HOSTED_URL + dart pub add", template: "PUB_HOSTED_URL=https://{domain} dart pub add {target}" },
      ],
      tabs: [
        { id: "readme", label: "README", icon: { kind: "lucide", name: "BookOpen" }, type: "code",
          language: "markdown",
          dataSource: {
            endpoint: "https://pub.dev/api/packages/{target}",
            responseType: "json",
          } },
        { id: "pubspec", label: "pubspec", icon: { kind: "lucide", name: "FileCode" }, type: "code",
          language: "yaml",
          dataSource: {
            endpoint: "https://pub.dev/api/packages/{target}",
            responsePath: "latest.pubspec",
            responseType: "json",
          } },
        { id: "versions", label: "版本列表", icon: { kind: "lucide", name: "Tag" }, type: "table",
          dataSource: {
            endpoint: "https://pub.dev/api/packages/{target}",
            responsePath: "versions",
            columns: [
              { field: "version", label: "版本号" },
            ],
          } },
      ],
      // SDK v2：从 info 元数据提取 repository 拉取上游 README 注入 readme tab（原 getDetail 覆写迁移）。
      // README 来自 GitHub/GitLab 仓库，baseUrl 需运行时从 repository 派生，供前端解析相对资源。
      hooks: {
        onInfoFetched: async (ctx) => {
          const repoUrl = String(getByPath(ctx.rawInfo ?? {}, "latest.pubspec.repository") ?? "");
          if (repoUrl) {
            const result = await fetchRepositoryReadme(repoUrl);
            if (result) {
              ctx.detail.tabs = ctx.detail.tabs.map((t) =>
                t.id === "readme"
                  ? { ...t, type: "markdown", data: result.content, language: undefined, baseUrl: result.docBase }
                  : t,
              );
            }
          }
        },
      },
    };
  }

  defineSetupGuide(): SetupGuideConfig {
    return {
      summary: "配置 Dart 使用 cloudMirror 镜像加速包下载。",
      quickCommand: "dart pub add package_name",
      sections: [
        { title: "PUB_HOSTED_URL (推荐)", items: [
          { label: "全局设置环境变量", value: "export PUB_HOSTED_URL=https://{domain}", mode: "block" },
          { label: "永久配置 (Linux/Mac)", value: 'echo \'export PUB_HOSTED_URL="https://{domain}"\' >> ~/.bashrc', mode: "block" },
          { label: "永久配置 (Windows)", value: 'setx PUB_HOSTED_URL "https://{domain}"', mode: "block" },
        ]},
        { title: "Dart CLI", items: [
          { label: "添加依赖", value: "dart pub add {example}", mode: "inline" },
          { label: "dart pub add", value: "dart pub add {example}", mode: "inline" },
          { label: "获取依赖", value: "dart pub get", mode: "inline" },
        ]},
        { title: "CI/CD 配置", items: [
          { label: "GitHub Actions", value: "- name: Setup dart\n  uses: subosito/dart-action@v2\n  with:\n    dart-version: '3.x'\n\n- name: Configure Pub mirror\n  run: echo 'PUB_HOSTED_URL=https://{domain}' >> $GITHUB_ENV", mode: "block" },
          { label: "Dockerfile", value: "ENV PUB_HOSTED_URL=https://{domain}", mode: "block" },
        ]},
      ],
    };
  }

  definePopularSearches(): PopularSearch[] {
    return [
      { name: "provider", description: "状态管理" },
      { name: "http", description: "HTTP 客户端" },
      { name: "riverpod", description: "响应式状态管理" },
      { name: "dio", description: "HTTP 网络库" },
    ];
  }
}

export const dartProvider = new DartProvider();
