// ============================================================================
// src/providers/packagist.provider.ts — PHP Composer/Packagist Provider
// ============================================================================
// 搜索: packagist.org/search.json?q=
// 详情: packagist.org/packages/{vendor}/{package}.json
// 代理: repo.packagist.org (Composer 仓库)
// ============================================================================

import { ProviderDefinition } from "./_base";
import type {
  ProviderMeta,
  SearchConfig,
  ResultMapping,
  ResultCardConfig,
  DetailConfig,
  SetupGuideConfig,
  PopularSearch,
} from "../shared/types";

export class PackagistProvider extends ProviderDefinition {
  readonly id = "packagist";
  readonly upstream = "https://repo.packagist.org";
  readonly authMode = "none" as const;

  readonly meta: ProviderMeta = {
    id: "packagist",
    name: "Packagist",
    label: "Composer",
    icon: { kind: "simple-icons", name: "siPackagist", colored: true },
    description: "PHP Composer 包管理镜像加速",
    searchEnabled: true,
    searchLabel: "搜索 PHP 包...",
    searchHint: "composer require symfony/console",
    setupComponent: "PackagistSetup",
    setupFields: [],
    enabled: true,
  };

  // ---- 搜索（声明式） ----

  readonly search: SearchConfig = {
    endpoint: "https://packagist.org/search.json",
    pagination: "page",
    pageParam: "page",
    pageSizeParam: "per_page",
  };

  // ---- 配置 ----

  defineResultMapping(): ResultMapping {
    return {
      itemsPath: "results",
      totalPath: "total",
      itemKind: "package",
      itemIdField: "name",
      fields: {
        title: "name",
        description: "description",
        subtitle: undefined,
        subtitlePrefix: undefined,
        url: "url",
        author: undefined,
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
      badges: [],
      descriptionShow: true,
      stats: [{ field: "stats.downloads", label: "下载" }],
      quickCommands: [
        {
          label: "composer require",
          template: "composer require {title}",
        },
      ],
      detailLink: "/detail?type=packagist&target={id}",
    };
  }

  defineDetail(): DetailConfig {
    return {
      // target = vendor/package
      infoEndpoint: "https://packagist.org/packages/{target}.json",
      infoMapping: {
        title: "package.name",
        description: "package.description",
        author: undefined,
        stats: [
          { label: "类型", path: "package.type" },
          {
            label: "总下载",
            path: "package.downloads.total",
            type: "number",
          },
          {
            label: "月下载",
            path: "package.downloads.monthly",
            type: "number",
          },
          {
            label: "仓库",
            path: "package.repository",
            type: "link",
          },
          {
            label: "GitHub Stars",
            path: "package.github_stars",
            type: "number",
          },
          {
            label: "GitHub Watchers",
            path: "package.github_watchers",
            type: "number",
          },
          {
            label: "GitHub Forks",
            path: "package.github_forks",
            type: "number",
          },
        ],
      },
      metaFields: { a: "package.name" },
      detailUrlTemplate: "https://packagist.org/packages/{target}",
      quickConnects: [
        {
          label: "composer require",
          template: "composer require {target}",
        },
        {
          label: "composer.json (手工)",
          template: '{\n  "require": {\n    "{target}": "^{version}"\n  }\n}',
        },
      ],
      tabs: [
        {
          id: "versions",
          label: "版本列表",
          icon: { kind: "lucide", name: "Tag" },
          type: "table",
          dataSource: {
            endpoint: "https://packagist.org/packages/{target}.json",
            responsePath: "package.versions",
            // versions 是 {{version}: {name,version,type,dist,source,...}} 对象
            columns: [
              { field: "version", label: "版本号" },
              { field: "version_normalized", label: "标准化版本" },
              { field: "type", label: "类型" },
            ],
          },
        },
      ],
    };
  }

  defineSetupGuide(): SetupGuideConfig {
    return {
      summary: "配置 Composer 使用 cloudMirror 镜像加速 PHP 依赖安装。",
      quickCommand: "composer config repos.packagist composer https://{domain}",
      sections: [
        {
          title: "Composer CLI (推荐)",
          items: [
            {
              label: "全局配置镜像",
              value: "composer config --global repos.packagist composer https://{domain}",
              mode: "block",
            },
            {
              label: "当前项目配置",
              value: "composer config repos.packagist composer https://{domain}",
              mode: "block",
            },
          ],
        },
        {
          title: "composer.json (项目级)",
          items: [
            {
              label: "手动添加到 composer.json",
              value:
                '{\n  "repositories": [\n    {\n      "type": "composer",\n      "url": "https://{domain}"\n    }\n  ]\n}',
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
                "- name: Setup PHP\n  uses: shivammathur/setup-php@v2\n  with:\n    php-version: '8.2'\n\n- name: Configure Composer mirror\n  run: composer config repos.packagist composer https://{domain}",
              mode: "block",
            },
            {
              label: "Dockerfile",
              value: "RUN composer config repos.packagist composer https://{domain}",
              mode: "block",
            },
          ],
        },
      ],
    };
  }

  definePopularSearches(): PopularSearch[] {
    return [
      { name: "symfony/console", description: "CLI 组件" },
      { name: "laravel/framework", description: "Web 应用框架" },
      { name: "guzzlehttp/guzzle", description: "HTTP 客户端" },
      { name: "phpunit/phpunit", description: "测试框架" },
      { name: "monolog/monolog", description: "日志库" },
    ];
  }
}

export const packagistProvider = new PackagistProvider();
