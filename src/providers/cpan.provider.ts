// ============================================================================
// src/providers/cpan.provider.ts — CPAN (MetaCPAN) Provider
// ============================================================================
// 搜索: fastapi.metacpan.org/v1/release/_search?q=
// 详情: fastapi.metacpan.org/v1/release/{distribution}
// 代理: cpan.metacpan.org
// ============================================================================

import { ProviderDefinition } from "./_base";
import { getByPath } from "../shared/utils/json-path";
import type {
  ProviderMeta,
  ResultMapping,
  ResultCardConfig,
  DetailConfig,
  SetupGuideConfig,
  PopularSearch,
  GenericSearchResponse,
} from "../shared/types";

export class CpanProvider extends ProviderDefinition {
  readonly id = "cpan";
  readonly upstream = "https://cpan.metacpan.org";
  readonly authMode = "none" as const;

  readonly meta: ProviderMeta = {
    id: "cpan",
    name: "CPAN",
    label: "Perl",
    icon: { kind: "simple-icons", name: "siPerl", colored: true },
    description: "Perl 模块仓库镜像加速",
    searchEnabled: true,
    searchLabel: "搜索 Perl 模块...",
    searchHint: "cpanm Moose --mirror https://{domain}/",
    setupComponent: "CpanSetup",
    setupFields: [],
    enabled: true,
  };

  // ---- 搜索 ----
  // MetaCPAN uses ElasticSearch API

  async doSearch(
    query: string,
    page: number,
    pageSize: number,
    _pat?: string,
  ): Promise<GenericSearchResponse | null> {
    const url = new URL("https://fastapi.metacpan.org/v1/release/_search");
    url.searchParams.set("q", query);
    url.searchParams.set("size", String(pageSize));
    url.searchParams.set("from", String((page - 1) * pageSize));

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "CloudMirror/4.0", Accept: "application/json" },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as Record<string, unknown>;
    // MetaCPAN wraps hits in {hits: {total, hits: [{_source: {...}}]}}
    const hits: unknown[] = (getByPath(data, "hits.hits") as unknown[]) ?? [];
    const total: number = (getByPath(data, "hits.total") as number) ?? hits.length;

    // 解包 _source
    const results = hits.map((hit: unknown) => {
      const source = (hit as Record<string, unknown>)._source ?? hit;
      return this.mapSearchItem(source);
    });

    return { results, total, page, pageSize };
  }

  // ---- 配置 ----

  defineResultMapping(): ResultMapping {
    return {
      itemsPath: "hits.hits",
      totalPath: "hits.total",
      itemKind: "package",
      itemIdField: "distribution",
      fields: {
        title: "distribution",
        description: "abstract",
        subtitle: "version",
        author: "author",
        url: undefined,
        stats: [
          {
            key: "authorName",
            path: "author",
            label: "作者",
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
      stats: [{ field: "stats.authorName", label: "作者" }],
      quickCommands: [
        {
          label: "cpanm",
          template: "cpanm {title}",
        },
      ],
      detailLink: "/detail?type=cpan&target={id}",
    };
  }

  defineDetail(): DetailConfig {
    return {
      infoEndpoint:
        "https://fastapi.metacpan.org/v1/release/{target}?fields=distribution,version,abstract,author,date,license,resources,metadata",
      infoMapping: {
        title: "distribution",
        description: "abstract",
        author: "author",
        stats: [
          { label: "版本", path: "version" },
          { label: "许可证", path: "license" },
          { label: "发布日期", path: "date" },
          { label: "主页", path: "resources.homepage", type: "link" },
          {
            label: "仓库",
            path: "resources.repository.url",
            type: "link",
          },
          {
            label: "Bug 跟踪",
            path: "resources.bugtracker.web",
            type: "link",
          },
        ],
      },
      metaFields: { version: "version", a: "distribution" },
      detailUrlTemplate: "https://metacpan.org/dist/{target}",
      quickConnects: [
        {
          label: "cpanm",
          template: "cpanm {target}",
        },
        {
          label: "Perl 脚本",
          template: "use {target};",
        },
      ],
      tabs: [
        {
          id: "versions",
          label: "历史版本",
          icon: { kind: "lucide", name: "Tag" },
          type: "table",
          dataSource: {
            endpoint:
              "https://fastapi.metacpan.org/v1/release/_search?q=distribution:{target}&size=50&sort=date:desc",
            responsePath: "hits.hits",
            // 需要解包 _source
            columns: [
              { field: "_source.version", label: "版本号" },
              { field: "_source.author", label: "作者" },
              { field: "_source.date", label: "发布日期", format: "date" },
              { field: "_source.status", label: "状态" },
            ],
          },
        },
      ],
    };
  }

  defineSetupGuide(): SetupGuideConfig {
    return {
      summary: "配置 CPAN 镜像指向 cloudMirror，加速 Perl 模块安装。",
      quickCommand: "cpanm Moose --mirror https://{domain}/ --mirror-only",
      sections: [
        {
          title: "cpanm (推荐)",
          items: [
            {
              label: "全局配置 PERL_CPANM_OPT",
              value: 'export PERL_CPANM_OPT="--mirror https://{domain}/ --mirror-only"',
              mode: "block",
            },
            {
              label: "单次安装",
              value: "cpanm Moose --mirror https://{domain}/ --mirror-only",
              mode: "inline",
            },
          ],
        },
        {
          title: "CPAN 客户端",
          items: [
            {
              label: "cpan 交互式配置",
              value: "cpan\n> o conf urllist push https://{domain}/\n> o conf commit",
              mode: "block",
            },
            {
              label: "CPAN/Config.pm 直接编辑",
              value: "$CPAN::Config->{urllist} = ['https://{domain}/'];",
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
                "- name: Setup Perl\n  uses: shogo82148/actions-setup-perl@v1\n  with:\n    perl-version: '5.40'\n\n- name: Install cpanm\n  run: |\\n    curl -L https://cpanmin.us | perl - App::cpanminus\n\n- name: Configure CPAN mirror\n  run: echo 'PERL_CPANM_OPT=--mirror https://{domain}/ --mirror-only' >> $GITHUB_ENV",
              mode: "block",
            },
            {
              label: "Dockerfile",
              value:
                "RUN curl -L https://cpanmin.us | perl - App::cpanminus \\\n  && echo 'export PERL_CPANM_OPT=\"--mirror https://{domain}/ --mirror-only\"' >> ~/.bashrc",
              mode: "block",
            },
          ],
        },
      ],
    };
  }

  definePopularSearches(): PopularSearch[] {
    return [
      { name: "Moose", description: "后现代对象系统" },
      { name: "DBI", description: "数据库接口" },
      { name: "Plack", description: "Web 中间件" },
      { name: "LWP", description: "HTTP 客户端库" },
      { name: "JSON", description: "JSON 编码/解码" },
    ];
  }
}

export const cpanProvider = new CpanProvider();
