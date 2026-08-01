// ============================================================================
// src/providers/gomod.provider.ts — Go Modules Provider
// ============================================================================
// 搜索: pkg.go.dev/v1beta/search (JSON API)
// 详情: pkg.go.dev/v1beta/module  + /v1beta/versions
// 代理: proxy.golang.org
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

export class GoModProvider extends ProviderDefinition {
  readonly id = "gomod";
  readonly upstream = "https://proxy.golang.org";
  readonly authMode = "none" as const;

  readonly meta: ProviderMeta = {
    id: "gomod",
    name: "Go Modules",
    label: "Go",
    icon: { kind: "simple-icons", name: "siGo", colored: true },
    description: "Go 模块代理镜像加速",
    searchEnabled: true,
    searchLabel: "搜索 Go 模块...",
    searchHint: "go get github.com/gin-gonic/gin",
    setupComponent: "GoModSetup",
    setupFields: [],
    enabled: true,
  };

  // ---- 搜索（声明式；token 分页无法回溯，page 恒 1） ----

  readonly search: SearchConfig = {
    endpoint: "https://pkg.go.dev/v1beta/search",
    pageSizeParam: "limit",
    pagination: "none",
  };

  // ---- 配置 ----

  defineResultMapping(): ResultMapping {
    return {
      itemsPath: "items",
      totalPath: "total",
      itemKind: "module",
      itemIdField: "packagePath",
      fields: {
        title: "modulePath",
        description: "synopsis",
        subtitle: "version",
        url: "packagePath",
        stats: [
          {
            key: "isStdLib",
            path: "isStandardLibrary",
            label: "标准库",
            format: "text",
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
      stats: [],
      quickCommands: [
        {
          label: "go get",
          template: "go get {title}",
        },
      ],
      detailLink: "/detail?type=gomod&target={id}",
    };
  }

  defineDetail(): DetailConfig {
    return {
      infoEndpoint: "https://pkg.go.dev/v1beta/module/{target}",
      infoMapping: {
        title: "path",
        description: "",
        stats: [
          { label: "最新版本", path: "version" },
          { label: "是否为最新", path: "isLatest" },
          { label: "标准库", path: "isStandardLibrary" },
          { label: "Go Module", path: "hasGoMod" },
          { label: "仓库", path: "repoUrl", type: "link" },
        ],
      },
      metaFields: { version: "version", a: "path" },
      detailUrlTemplate: "https://pkg.go.dev/{target}",
      quickConnects: [
        {
          label: "go get",
          template: "go get {target}",
        },
        {
          label: "go.mod",
          template: "require {target} {version}",
        },
      ],
      tabs: [
        {
          id: "versions",
          label: "版本列表",
          icon: { kind: "lucide", name: "Tag" },
          type: "table",
          dataSource: {
            endpoint:
              "https://pkg.go.dev/v1beta/versions/{target}?limit=50",
            responsePath: "items",
            columns: [
              { field: "version", label: "版本号" },
              { field: "commitTime", label: "提交时间", format: "date" },
              { field: "deprecated", label: "已弃用", emptyText: "否" },
              { field: "retracted", label: "已撤回", emptyText: "否" },
            ],
          },
        },
      ],
    };
  }

  defineSetupGuide(): SetupGuideConfig {
    return {
      summary:
        "设置 GOPROXY 环境变量指向 cloudMirror，加速 Go 模块下载。",
      quickCommand: "go env -w GOPROXY=https://{domain},direct",
      sections: [
        {
          title: "全局配置",
          items: [
            {
              label: "设置 GOPROXY",
              value: "go env -w GOPROXY=https://{domain},direct",
              mode: "block",
            },
            {
              label: "验证配置",
              value: "go env GOPROXY",
              mode: "inline",
            },
          ],
        },
        {
          title: "私有模块",
          items: [
            {
              label: "GOPRIVATE (私有仓库不走代理)",
              value: "go env -w GOPRIVATE=github.com/mycompany/*,gitlab.internal/*",
              mode: "block",
            },
            {
              label: "GONOSUMDB (跳过校验和数据库)",
              value: "go env -w GONOSUMDB=github.com/mycompany/*",
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
                "- name: Set up Go\n  uses: actions/setup-go@v5\n  with:\n    go-version: '1.22'\n\n- name: Configure GOPROXY\n  run: go env -w GOPROXY=https://{domain},direct",
              mode: "block",
            },
            {
              label: "Dockerfile",
              value:
                "ENV GOPROXY=https://{domain},direct",
              mode: "block",
            },
          ],
        },
      ],
    };
  }

  definePopularSearches(): PopularSearch[] {
    return [
      { name: "gin", description: "Go HTTP Web 框架" },
      { name: "gorm", description: "ORM 库" },
      { name: "zap", description: "高性能日志库" },
      { name: "cobra", description: "CLI 框架" },
    ];
  }
}

export const gomodProvider = new GoModProvider();
