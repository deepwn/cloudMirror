// ============================================================================
// src/providers/rubygems.provider.ts — RubyGems Provider
// ============================================================================
// 搜索: rubygems.org/api/v1/search.json
// 详情: rubygems.org/api/v1/gems/{name}.json
// 版本: rubygems.org/api/v1/versions/{name}.json
// 代理: rubygems.org
// ============================================================================

import { ProviderDefinition } from "./_base";
import type {
  ProviderMeta,
  ResultMapping,
  ResultCardConfig,
  DetailConfig,
  SetupGuideConfig,
  PopularSearch,
  GenericSearchResponse,
} from "../shared/types";

export class RubyGemsProvider extends ProviderDefinition {
  readonly id = "rubygems";
  readonly upstream = "https://rubygems.org";
  readonly authMode = "none" as const;

  readonly meta: ProviderMeta = {
    id: "rubygems",
    name: "RubyGems",
    label: "Ruby",
    icon: { kind: "simple-icons", name: "siRubygems", colored: true },
    description: "Ruby 包管理镜像加速",
    searchEnabled: true,
    searchLabel: "搜索 Ruby Gem...",
    searchHint: "gem install rails --source https://{domain}/",
    setupComponent: "RubyGemsSetup",
    setupFields: [],
    enabled: true,
  };

  // ---- 搜索 ----

  async doSearch(
    query: string,
    page: number,
    pageSize: number,
    _pat?: string,
  ): Promise<GenericSearchResponse | null> {
    const url = new URL("https://rubygems.org/api/v1/search.json");
    url.searchParams.set("query", query);
    // RubyGems search returns all results, we do client-side pagination
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "CloudMirror/4.0", Accept: "application/json" },
    });
    if (!res.ok) return null;

    const all: unknown[] = (await res.json()) as unknown[];
    const total = all.length;
    const start = (page - 1) * pageSize;
    const sliced = all.slice(start, start + pageSize);

    const results = sliced.map((raw: unknown) => this.mapSearchItem(raw));

    return { results, total, page, pageSize };
  }

  // ---- 配置 ----

  defineResultMapping(): ResultMapping {
    return {
      itemsPath: "",
      totalPath: "",
      itemKind: "package",
      itemIdField: "name",
      fields: {
        title: "name",
        description: "info",
        subtitle: "version",
        url: "homepage_uri",
        stats: [
          {
            key: "downloads",
            path: "downloads",
            label: "总下载",
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
      quickCommands: [
        {
          label: "gem install",
          template: "gem install {title} --source https://{domain}/",
        },
      ],
      detailLink: "/detail?type=rubygems&target={id}",
    };
  }

  defineDetail(): DetailConfig {
    return {
      infoEndpoint: "https://rubygems.org/api/v1/gems/{target}.json",
      infoMapping: {
        title: "name",
        description: "info",
        author: "authors",
        stats: [
          { label: "最新版本", path: "version" },
          { label: "总下载", path: "downloads", type: "number" },
          { label: "许可证", path: "licenses" },
          { label: "主页", path: "homepage_uri", type: "link" },
          { label: "源码", path: "source_code_uri", type: "link" },
          { label: "文档", path: "documentation_uri", type: "link" },
          { label: "Bug 跟踪", path: "bug_tracker_uri", type: "link" },
        ],
      },
      metaFields: { version: "version", a: "name" },
      detailUrlTemplate: "https://rubygems.org/gems/{target}",
      quickConnects: [
        {
          label: "gem install",
          template: "gem install {target} --source https://{domain}/",
        },
        {
          label: "Gemfile",
          template: "gem '{target}', '~> {version}'",
        },
      ],
      tabs: [
        {
          id: "versions",
          label: "版本列表",
          icon: { kind: "lucide", name: "Tag" },
          type: "table",
          dataSource: {
            endpoint: "https://rubygems.org/api/v1/versions/{target}.json",
            responsePath: "",
            columns: [
              { field: "number", label: "版本号" },
              { field: "platform", label: "平台" },
              { field: "licenses", label: "许可证" },
              { field: "created_at", label: "发布时间", format: "date" },
            ],
          },
        },
      ],
    };
  }

  defineSetupGuide(): SetupGuideConfig {
    return {
      summary: "配置 RubyGems 源指向 cloudMirror，加速 gem 安装。",
      quickCommand: "gem install rails --source https://{domain}/",
      sections: [
        {
          title: "gem CLI",
          items: [
            {
              label: "添加镜像源",
              value: "gem sources --add https://{domain}/",
              mode: "block",
            },
            {
              label: "移除默认源 (可选)",
              value: "gem sources --remove https://rubygems.org/",
              mode: "inline",
            },
            {
              label: "查看当前源",
              value: "gem sources --list",
              mode: "inline",
            },
          ],
        },
        {
          title: "Bundler",
          items: [
            {
              label: "全局镜像配置",
              value: "bundle config mirror.https://rubygems.org https://{domain}",
              mode: "block",
            },
            {
              label: "项目级配置 (.bundle/config)",
              value: "---\nBUNDLE_MIRROR__HTTPS://RUBYGEMS__ORG/: https://{domain}",
              mode: "block",
            },
          ],
        },
        {
          title: "CI/CD 配置",
          items: [
            {
              label: "GitHub Actions",
              value:
                "- name: Set up Ruby\n  uses: ruby/setup-ruby@v1\n  with:\n    bundler-cache: true\n\n- name: Configure RubyGems mirror\n  run: |\n    gem sources --add https://{domain}/ || true\n    bundle config mirror.https://rubygems.org https://{domain}",
              mode: "block",
            },
          ],
        },
      ],
    };
  }

  definePopularSearches(): PopularSearch[] {
    return [
      { name: "rails", description: "Web 应用框架" },
      { name: "rspec", description: "测试框架" },
      { name: "devise", description: "认证方案" },
      { name: "sidekiq", description: "后台任务" },
      { name: "nokogiri", description: "HTML/XML 解析器" },
    ];
  }
}

export const rubygemsProvider = new RubyGemsProvider();
