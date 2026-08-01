// ============================================================================
// src/providers/cran.provider.ts — CRAN (R Language) Provider
// ============================================================================

import { ProviderDefinition } from "./_base";
import type {
  ProviderMeta,
  ResultMapping, ResultCardConfig, DetailConfig, SetupGuideConfig, PopularSearch,
  GenericSearchResponse,
} from "../shared/types";

export class CranProvider extends ProviderDefinition {
  readonly id = "cran";
  readonly upstream = "https://cloud.r-project.org";
  readonly authMode = "none" as const;

  readonly meta: ProviderMeta = {
    id: "cran", name: "CRAN", label: "R",
    icon: { kind: "simple-icons", name: "siR", colored: true },
    description: "R 语言综合归档网络镜像加速",
    searchEnabled: true, searchLabel: "搜索 R 包...",
    searchHint: "install.packages(\"package_name\")",
    setupComponent: "CranSetup", setupFields: [],
    enabled: true,
  };

  // ---- 搜索：使用 crandb.r-pkg.org /-/desc 端点 ----

  async doSearch(query: string, page: number, pageSize: number, _pat?: string): Promise<GenericSearchResponse | null> {
    // crandb /-/desc 的 q 参数是 CouchDB startkey，会返回所有包而非仅匹配的。
    // 必须客户端侧过滤匹配关键词的包。
    const q = encodeURIComponent(query);
    const res = await fetch(`https://crandb.r-pkg.org/-/desc?q=${q}`);
    if (!res.ok) return null;

    const rawObj = await res.json() as Record<string, unknown>;
    if (!rawObj || typeof rawObj !== "object") return { results: [], total: 0, page, pageSize };

    const lowerQuery = query.toLowerCase();

    // 对象转数组，并客户端过滤匹配
    const allDocs = Object.entries(rawObj)
      .filter(([key]) => key.toLowerCase().includes(lowerQuery))
      .map(([key, val]) => {
        const v = val as Record<string, unknown>;
        return { Package: key, Version: v.version ?? "", Title: v.title ?? "", Author: v.author ?? "", URL: v.url ?? "" };
      });

    const total = allDocs.length;
    const start = (page - 1) * pageSize;
    const items = allDocs.slice(start, start + pageSize).map((raw: unknown) => this.mapSearchItem(raw));

    return { results: items, total, page, pageSize };
  }

  // ---- 配置 ----

  defineResultMapping(): ResultMapping {
    return {
      itemsPath: "", totalPath: "",
      itemKind: "package", itemIdField: "Package",
      fields: {
        title: "Package", description: "Title",
        subtitle: "Version",
        author: "Author", url: "URL",
        stats: [],
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
        { label: "install.packages",
          template: 'install.packages("{title}", repos = "https://{domain}/")' },
      ],
      detailLink: "/detail?type=cran&target={id}",
    };
  }

  defineDetail(): DetailConfig {
    return {
      infoEndpoint: "https://crandb.r-pkg.org/{target}",
      infoMapping: {
        title: "Package", description: "Title", author: "Author",
        stats: [
          { label: "版本", path: "Version" },
          { label: "许可", path: "License" },
        ],
      },
      metaFields: { version: "Version", a: "Package" },
      detailUrlTemplate: "https://cran.r-project.org/web/packages/{target}/index.html",
      quickConnects: [
        { label: "install.packages", template: 'install.packages("{target}", repos = "https://{domain}/")' },
      ],
      tabs: [
        { id: "description", label: "说明", icon: { kind: "lucide", name: "FileText" }, type: "code",
          language: "text",
          dataSource: {
            endpoint: "https://crandb.r-pkg.org/{target}",
            responseType: "json",
          } },
        { id: "dependencies", label: "依赖", icon: { kind: "lucide", name: "Workflow" }, type: "keyValue",
          dataSource: {
            endpoint: "https://crandb.r-pkg.org/{target}",
            responsePath: "Depends",
          } },
        { id: "versions", label: "版本历史", icon: { kind: "lucide", name: "Tag" }, type: "table",
          dataSource: {
            endpoint: "https://crandb.r-pkg.org/{target}/all",
            responsePath: "versions",
            columns: [
              { field: "Version", label: "版本号" },
              { field: "Date", label: "发布日期" },
            ],
          } },
      ],
    };
  }

  defineSetupGuide(): SetupGuideConfig {
    return {
      summary: "配置 R 使用 cloudMirror CRAN 镜像加速包安装。",
      quickCommand: 'install.packages("package_name", repos = "https://{domain}/")',
      sections: [
        { title: "R 控制台 (推荐)", items: [
          { label: "全局设置 CRAN 镜像", value: 'options(repos = c(CRAN = "https://{domain}/"))', mode: "block" },
          { label: "单次安装", value: 'install.packages("ggplot2", repos = "https://{domain}/")', mode: "inline" },
        ]},
        { title: "配置文件 (.Rprofile)", items: [
          { label: "用户级 .Rprofile", value: 'local({\n  r <- getOption("repos")\n  r["CRAN"] <- "https://{domain}/"\n  options(repos = r)\n})', mode: "block" },
          { label: "RStudio 配置", value: "Tools → Global Options → Packages → CRAN Mirror → 自定义 → https://{domain}/", mode: "block" },
        ]},
        { title: "CI/CD 配置", items: [
          { label: "GitHub Actions", value: '- name: Setup R\n  uses: r-lib/actions/setup-r@v2\n  with:\n    r-version: \'4.4\'\n\n- name: Configure CRAN mirror\n  run: echo \'options(repos = c(CRAN = "https://{domain}/"))\' >> .Rprofile', mode: "block" },
          { label: "Dockerfile", value: 'RUN echo \'options(repos = c(CRAN = "https://{domain}/"))\' >> /usr/local/lib/R/etc/Rprofile.site', mode: "block" },
        ]},
      ],
    };
  }

  definePopularSearches(): PopularSearch[] {
    return [
      { name: "ggplot2", description: "数据可视化" },
      { name: "dplyr", description: "数据操作语法" },
      { name: "shiny", description: "交互式 Web 应用" },
      { name: "data.table", description: "高性能数据处理" },
    ];
  }
}

export const cranProvider = new CranProvider();
