// ============================================================================
// src/providers/pypi.provider.ts — PyPI Provider
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

// ---- HTML 解析工具 ----

/** 解码 HTML 实体 (&#39; &quot; &amp; &lt; &gt; &#xNNNN;) */
function decodeHTMLEntities(raw: string): string {
  return raw
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

/** 移除 HTML 标签 */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

export class PyPIProvider extends ProviderDefinition {
  readonly id = "pypi";
  readonly upstream = "https://pypi.org";
  readonly authMode = "none" as const;

  readonly meta: ProviderMeta = {
    id: "pypi",
    name: "PyPI",
    icon: { kind: "simple-icons", name: "siPython", colored: true }, // siPypi not good for view
    description: "Python 包索引与下载加速",
    searchEnabled: true,
    searchLabel: "搜索 Python 包...",
    searchHint: "pip install requests -i https://{hash}.mirror.example.com/simple",
    setupComponent: "PyPISetup",
    setupFields: [],
    enabled: true,
  };

  // ---- 代理（SDK v2：文件 CDN 路由 + /simple HTML 链接重写） ----
  readonly proxy: ProxyConfig = {
    routes: [
      { prefix: "/packages/", upstream: "https://files.pythonhosted.org" },
      { prefix: "/files/", upstream: "https://files.pythonhosted.org" },
    ],
    hooks: {
      onBuildRequest: (ctx) => {
        // /simple 索引 HTML 需重写文件 URL，请求未压缩文本便于处理
        if (new URL(ctx.request.url).pathname.startsWith("/simple/")) {
          ctx.headers.delete("Accept-Encoding");
        }
      },
      onSend: async (ctx) => {
        const url = new URL(ctx.request.url);
        if (!url.pathname.startsWith("/simple/")) return;
        const res = ctx.response!;
        const text = await res.text();
        // PyPI simple 索引中的文件链接为 https://files.pythonhosted.org/... 绝对 URL，
        // 重写为 mirror host，保证包文件下载走代理（/packages/ → files.pythonhosted.org）
        const rewritten = text.replaceAll("https://files.pythonhosted.org", `https://${url.host}`);
        const headers = new Headers(res.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        ctx.response = new Response(rewritten, { status: res.status, headers });
      },
    },
  };

  async doSearch(query: string, page: number, pageSize: number, _pat?: string): Promise<GenericSearchResponse | null> {
    // 策略1: 精确匹配 — 直接请求 JSON API，最稳定
    const exactUrl = `https://pypi.org/pypi/${encodeURIComponent(query)}/json`;
    let exactHit: { name: string; version: string; description: string } | null = null;

    try {
      const exactRes = await fetch(exactUrl, {
        headers: { "User-Agent": "CloudMirror/4.0", Accept: "application/json" },
      });
      if (exactRes.ok) {
        const data = await exactRes.json() as Record<string, unknown>;
        const info = (data.info ?? {}) as Record<string, unknown>;
        exactHit = {
          name: String(info.name ?? query),
          version: String(info.version ?? ""),
          description: String(info.summary ?? ""),
        };
      }
    } catch {
      // 精确匹配失败，继续 HTML 搜索
    }

    // 策略2: HTML 搜索页解析 — 获取更多结果
    const htmlUrl = new URL("https://pypi.org/search/");
    htmlUrl.searchParams.set("q", query);

    let htmlResults: { name: string; version: string; description: string }[] = [];

    try {
      const res = await fetch(htmlUrl.toString(), {
        headers: {
          "Accept": "text/html",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0 (compatible; CloudMirror/4.0; +https://cloudmirror.dev)",
        },
      });
      if (res.ok) {
        const html = await res.text();

        // 稳健正则：逐个匹配 package-snippet 块，容忍属性变化与空白
        const snippetRx = /<a\b[^>]*\bclass="[^"]*\bpackage-snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
        const snippets: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = snippetRx.exec(html)) !== null) {
          snippets.push(m[1]);
        }

        for (const snip of snippets) {
          const nameM = snip.match(/<span\b[^>]*\bclass="[^"]*\bpackage-snippet__name\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
          const verM = snip.match(/<span\b[^>]*\bclass="[^"]*\bpackage-snippet__version\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
          const descM = snip.match(/<p\b[^>]*\bclass="[^"]*\bpackage-snippet__description\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i);

          if (nameM) {
            htmlResults.push({
              name: decodeHTMLEntities(nameM[1].trim()),
              version: verM ? decodeHTMLEntities(verM[1].trim()) : "",
              description: descM ? decodeHTMLEntities(stripTags(descM[1]).trim()) : "",
            });
          }
        }
      }
    } catch {
      // HTML 解析失败，仅依靠精确匹配结果
    }

    // 合并结果：精确匹配排第一，去重
    const seen = new Set<string>();
    const merged: { name: string; version: string; description: string }[] = [];

    if (exactHit && !seen.has(exactHit.name.toLowerCase())) {
      seen.add(exactHit.name.toLowerCase());
      merged.push(exactHit);
    }
    for (const r of htmlResults) {
      if (!seen.has(r.name.toLowerCase())) {
        seen.add(r.name.toLowerCase());
        merged.push(r);
      }
    }

    const total = merged.length;
    const start = (page - 1) * pageSize;
    const sliced = merged.slice(start, start + pageSize);

    return {
      results: sliced.map((raw) => this.mapSearchItem(raw)),
      total,
      page,
      pageSize,
    };
  }

  defineResultMapping(): ResultMapping {
    return {
      itemsPath: "results",
      totalPath: "total",
      itemKind: "package",
      itemIdField: "name",
      fields: {
        title: "name",
        description: "description",
        subtitle: "version",
        url: "url",
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
      quickCommands: [{ label: "pip install", template: "pip install {title} -i https://{domain}/simple" }],
      detailLink: "/detail?type=pypi&target={id}",
    };
  }

  defineDetail(): DetailConfig {
    return {
      infoEndpoint: "https://pypi.org/pypi/{target}/json",
      infoMapping: {
        title: "info.name",
        description: "info.summary",
        author: "info.author",
        stats: [
          { label: "版本", path: "info.version" },
          { label: "许可证", path: "info.license" },
          { label: "主页", path: "info.home_page" },
        ],
      },
      metaFields: { version: "info.version", a: "info.name" },
      detailUrlTemplate: "https://pypi.org/project/{target}",
      quickConnects: [
        { label: "pip install", template: "pip install {target} -i https://{domain}/simple" },
        { label: "uv pip install", template: "uv pip install {target} --index-url https://{domain}/simple" },
      ],
      tabs: [
        {
          id: "readme",
          label: "README",
          icon: { kind: "lucide", name: "BookOpen" },
          type: "markdown",
          dataSource: { endpoint: "https://pypi.org/pypi/{target}/json", responsePath: "info.description" },
        },
        {
          id: "urls",
          label: "分发文件",
          icon: { kind: "lucide", name: "Package" },
          type: "table",
          dataSource: {
            endpoint: "https://pypi.org/pypi/{target}/json",
            responsePath: "urls",
            columns: [
              { field: "filename", label: "文件名" },
              { field: "packagetype", label: "类型" },
              { field: "size", label: "大小", format: "bytes" },
              { field: "upload_time_iso_8601", label: "上传时间", format: "date" },
            ],
          },
        },
      ],
    };
  }

  defineSetupGuide(): SetupGuideConfig {
    return {
      summary: "为 pip、uv、Poetry 提供 Python 包安装加速。",
      quickCommand: "pip config set global.index-url https://{domain}/simple",
      sections: [
        {
          title: "pip (推荐)",
          items: [
            { label: "全局配置", value: "pip config set global.index-url https://{domain}/simple", mode: "block" },
            { label: "单次使用", value: "pip install requests -i https://{domain}/simple", mode: "inline" },
            { label: "恢复默认", value: "pip config unset global.index-url", mode: "inline" },
          ],
        },
        {
          title: "uv",
          items: [
            { label: "安装依赖", value: "uv pip install requests --index-url https://{domain}/simple", mode: "inline" },
            { label: "编译锁文件", value: "uv pip compile requirements.in --index-url https://{domain}/simple -o requirements.txt", mode: "block" },
            { label: "全局默认索引", value: "export UV_INDEX_URL=https://{domain}/simple", mode: "block" },
          ],
        },
        {
          title: "Poetry",
          items: [
            { label: "添加源", value: "poetry source add --priority=primary cloudmirror https://{domain}/simple", mode: "block" },
            { label: "pyproject.toml", value: '[[tool.poetry.source]]\nname = "cloudmirror"\nurl = "https://{domain}/simple"\npriority = "primary"', mode: "block" },
          ],
        },
        {
          title: "CI/CD 配置",
          items: [
            { label: "GitHub Actions", value: "- name: Set up Python\n  uses: actions/setup-python@v5\n  with:\n    python-version: '3.12'\n\n- name: Configure PyPI mirror\n  run: pip config set global.index-url https://{domain}/simple", mode: "block" },
            { label: "Dockerfile", value: "RUN pip config set global.index-url https://{domain}/simple", mode: "block" },
          ],
        },
      ],
    };
  }

  definePopularSearches(): PopularSearch[] {
    return [
      { name: "requests", description: "HTTP 客户端" },
      { name: "numpy", description: "数值计算" },
      { name: "pydantic", description: "数据校验" },
      { name: "fastapi", description: "Python Web 框架" },
    ];
  }
}

export const pypiProvider = new PyPIProvider();