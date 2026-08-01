// ============================================================================
// src/providers/nuget.provider.ts — NuGet Provider
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

export class NuGetProvider extends ProviderDefinition {
  readonly id = "nuget";
  // 根路径：用户配置 https://{domain}/v3/index.json，代理拼接 path 后直达 api.nuget.org/v3/...
  readonly upstream = "https://api.nuget.org";
  readonly authMode = "none" as const;

  readonly meta: ProviderMeta = {
    id: "nuget",
    name: "NuGet",
    icon: { kind: "simple-icons", name: "siNuget", colored: true },
    description: ".NET NuGet 包管理镜像加速",
    searchEnabled: true,
    searchLabel: "搜索 NuGet 包...",
    searchHint: "dotnet add package Newtonsoft.Json --source https://{domain}/v3/index.json",
    setupComponent: "NuGetSetup",
    setupFields: [],
    enabled: true,
  };

  // ---- 搜索（声明式） ----

  readonly search: SearchConfig = {
    endpoint: "https://azuresearch-usnc.nuget.org/query",
    pagination: "offset",
    pageSizeParam: "take",
    offsetParam: "skip",
    extraParams: { prerelease: "false" },
  };

  // ---- 配置 ----

  defineResultMapping(): ResultMapping {
    return {
      itemsPath: "data",
      totalPath: "totalHits",
      itemKind: "package",
      itemIdField: "id",
      fields: {
        title: "id",
        description: "description",
        subtitle: "version",
        author: "authors[0]",
        url: "projectUrl",
        stats: [
          {
            key: "downloads",
            path: "totalDownloads",
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
          label: ".NET CLI",
          template:
            "dotnet add package {title} --version {subtitle} --source https://{domain}/v3/index.json",
        },
      ],
      detailLink: "/detail?type=nuget&target={id}",
    };
  }

  defineDetail(): DetailConfig {
    return {
      infoEndpoint:
        "https://azuresearch-usnc.nuget.org/query?q=PackageId:{target}&take=1",
      infoMapping: {
        title: "data[0].id",
        description: "data[0].description",
        author: "data[0].authors[0]",
        stats: [
          { label: "最新版本", path: "data[0].version" },
          {
            label: "总下载",
            path: "data[0].totalDownloads",
            type: "number",
          },
          {
            label: "所有者",
            path: "data[0].owners",
          },
          {
            label: "项目地址",
            path: "data[0].projectUrl",
            type: "link",
          },
          {
            label: "许可证",
            path: "data[0].licenseUrl",
            type: "link",
          },
        ],
      },
      metaFields: { version: "data[0].version", a: "data[0].id" },
      detailUrlTemplate: "https://www.nuget.org/packages/{target}",
      quickConnects: [
        {
          label: ".NET CLI",
          template:
            "dotnet add package {target} --source https://{domain}/v3/index.json",
        },
        {
          label: "PackageReference",
          template:
            '<PackageReference Include="{target}" Version="{version}" />',
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
              "https://azuresearch-usnc.nuget.org/query?q=PackageId:{target}&take=1",
            responsePath: "data[0].versions",
            columns: [
              { field: "version", label: "版本号" },
              {
                field: "downloads",
                label: "下载量",
                format: "number",
              },
            ],
          },
        },
      ],
    };
  }

  defineSetupGuide(): SetupGuideConfig {
    return {
      summary:
        "配置 NuGet 源指向 cloudMirror，加速 .NET 包安装。",
      quickCommand:
        "dotnet add package Newtonsoft.Json --source https://{domain}/v3/index.json",
      sections: [
        {
          title: "nuget.config (推荐)",
          items: [
            {
              label: "项目或解决方案级配置",
              value:
                '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <packageSources>\n    <clear />\n    <add key="cloudmirror" value="https://{domain}/v3/index.json" />\n  </packageSources>\n</configuration>',
              mode: "block",
            },
          ],
        },
        {
          title: "dotnet CLI",
          items: [
            {
              label: "添加源",
              value:
                "dotnet nuget add source https://{domain}/v3/index.json --name cloudmirror",
              mode: "block",
            },
            {
              label: "禁用默认源",
              value:
                "dotnet nuget disable source nuget.org",
              mode: "inline",
            },
            {
              label: "单次使用",
              value:
                "dotnet add package {example} --source https://{domain}/v3/index.json",
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
                "- name: Setup .NET\n  uses: actions/setup-dotnet@v4\n\n- name: Configure NuGet\n  run: dotnet nuget add source https://{domain}/v3/index.json --name cloudmirror",
              mode: "block",
            },
          ],
        },
      ],
    };
  }

  definePopularSearches(): PopularSearch[] {
    return [
      { name: "Newtonsoft.Json", description: "JSON 框架" },
      { name: "Serilog", description: "日志库" },
      { name: "AutoMapper", description: "对象映射" },
      { name: "Polly", description: "弹性与瞬态故障处理" },
    ];
  }
}

export const nugetProvider = new NuGetProvider();
