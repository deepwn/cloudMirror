// ============================================================================
// src/providers/npm.provider.ts — npm Registry Provider
// ============================================================================

import { ProviderDefinition } from "./_base";
import type {
  ProviderMeta,
  SearchConfig,
  ResultMapping, ResultCardConfig, DetailConfig, SetupGuideConfig, PopularSearch,
} from "../shared/types";

export class NpmProvider extends ProviderDefinition {
  readonly id = "npm";
  readonly upstream = "https://registry.npmjs.org";
  readonly authMode = "none" as const;

  readonly meta: ProviderMeta = {
    id: "npm", name: "npm Registry", label: "npm", icon: { kind: "simple-icons", name: "siNpm", colored: true },
    description: "Node.js 包管理器镜像加速",
    searchEnabled: true, searchLabel: "npm 包",
    searchHint: "搜索 npm 包...",
    setupComponent: "NpmSetup", setupFields: [],
    enabled: true,
  };

  // ---- 搜索（声明式） ----

  readonly search: SearchConfig = {
    endpoint: "https://registry.npmjs.org/-/v1/search",
    queryParam: "text",
    pagination: "offset",
    pageSizeParam: "size",
    offsetParam: "from",
  };

  // ---- 配置 ----

  defineResultMapping(): ResultMapping {
    return {
      itemsPath: "objects", totalPath: "total",
      itemKind: "package", itemIdField: "package.name",
      fields: {
        title: "package.name", description: "package.description",
        subtitle: "package.version",
        author: "package.publisher?.username", url: "package.links.npm",
        stats: [
          { key: "downloads", path: "package.downloads", label: "周下载", format: "number" },
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
        { label: "npm install",
          template: "npm install {title} --registry https://{domain}" },
      ],
      detailLink: "/detail?type=npm&target={id}",
    };
  }

  defineDetail(): DetailConfig {
    return {
      infoEndpoint: "https://registry.npmjs.org/{target}",
      infoMapping: {
        title: "name", description: "description", author: "author?.name",
        stats: [
          { label: "许可证", path: "license" },
          { label: "版本", path: "dist-tags?.latest" },
          { label: "主页", path: "homepage", type: "link" },
        ],
      },
      metaFields: { version: "dist-tags.latest", a: "name" },
      detailUrlTemplate: "https://www.npmjs.com/package/{target}",
      tabs: [
        { id: "readme", label: "README", icon: { kind: "lucide", name: "BookOpen" }, type: "markdown",
          dataSource: { endpoint: "https://registry.npmjs.org/{target}/readme", responseType: "text" } },
        { id: "versions", label: "版本列表", icon: { kind: "lucide", name: "Tag" }, type: "table",
          dataSource: {
            endpoint: "https://registry.npmjs.org/{target}", responsePath: "versions",
            columns: [
              { field: "version", label: "版本号" },
              { field: "license", label: "许可证", emptyText: "-" },
            ],
          } },
        { id: "dependencies", label: "依赖", icon: { kind: "lucide", name: "Workflow" }, type: "keyValue",
          dataSource: { endpoint: "https://registry.npmjs.org/{target}/latest", responsePath: "dependencies" } },
      ],
    };
  }

  defineSetupGuide(): SetupGuideConfig {
    return {
      summary: "将 npm 源指向 cloudMirror 以获得加速。",
      quickCommand: "npm config set registry https://{domain}",
      sections: [
        { title: "npm CLI (推荐)", items: [
          { label: "全局设置 registry", value: "npm config set registry https://{domain}", mode: "block" },
          { label: "单次使用", value: "npm install {example} --registry https://{domain}", mode: "inline" },
          { label: "恢复默认", value: "npm config delete registry", mode: "inline" },
        ]},
        { title: "yarn", items: [
          { label: "全局设置 (yarn v1)", value: "yarn config set registry https://{domain}", mode: "block" },
          { label: "单次使用", value: "yarn add {example} --registry https://{domain}", mode: "inline" },
        ]},
        { title: "pnpm", items: [
          { label: "全局设置", value: "pnpm config set registry https://{domain}", mode: "block" },
          { label: ".npmrc 方式", value: "registry=https://{domain}", mode: "block" },
        ]},
        { title: "CI/CD 配置", items: [
          { label: "GitHub Actions", value: "- name: Setup Node.js\n  uses: actions/setup-node@v4\n  with:\n    node-version: '20'\n    registry-url: 'https://{domain}'", mode: "block" },
          { label: "Dockerfile", value: "RUN npm config set registry https://{domain}", mode: "block" },
        ]},
      ],
    };
  }

  definePopularSearches(): PopularSearch[] {
    return [
      { name: "react", description: "UI 框架" },
      { name: "vue", description: "渐进式框架" },
      { name: "express", description: "Web 框架" },
      { name: "lodash", description: "工具库" },
    ];
  }
}

export const npmProvider = new NpmProvider();
