// ============================================================================
// src/providers/_base.ts — ProviderDefinition 抽象基类（SDK v2）
// ============================================================================

import type {
  ProviderMeta, GenericSearchItem, GenericSearchResponse,
  ResultMapping, ResultCardConfig, DetailConfig, DetailData, DetailTabData,
  SetupGuideConfig, PopularSearch, ResolvedRoute, MetaFieldsConfig,
  ProxyConfig, ProxyContext, SearchConfig, SearchContext,
  DetailContext, RenderContract, ProviderDocs, DocsSection,
} from "../shared/types";
import { getByPath } from "../shared/utils/json-path";
import { decodeBase64Content } from "./utils/base64";

// ============================================================================
// ProviderDefinition
// ============================================================================

export abstract class ProviderDefinition {

  // ============ 必须覆写 ============

  /** 全局唯一标识，对应 user_providers.provider */
  abstract readonly id: string;

  /** 前端展示元数据 */
  abstract readonly meta: ProviderMeta;

  get displayName(): string {
    return this.meta.label || this.meta.name;
  }

  /** 上游主机 */
  abstract readonly upstream: string;

  /** 认证模式 */
  abstract readonly authMode: "none" | "bearer" | "basic";

  // ============ 代理配置 (SDK v2 声明式，多数 Provider 无需覆写 handleProxy) ============

  /** 代理管线配置：路由表 + hooks。详情见 docs/architecture.md §2.2 */
  readonly proxy: ProxyConfig = { routes: [] };

  // ============ 核心方法 ============

  /**
   * 代理请求 → Response。
   * 默认管线：onResolve（路由表最长前缀匹配 → target）→ 默认头 + onBuildRequest →
   * fetch → onSend（CORS 头/改写）→ 输出。hook 抛错默认降级 502。
   * 特殊 Provider 仍可整体覆写此方法（逃生舱，如 Docker token 交换走 hooks 即可）。
   */
  async handleProxy(request: Request, route: ResolvedRoute): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const proxy = this.proxy;

    const ctx: ProxyContext = {
      request,
      route,
      target: (proxy.defaultUpstream ?? this.upstream) + path + url.search,
      headers: new Headers(),
      body: undefined,
    };

    try {
      // 1. onResolve：路由表最长前缀匹配 + hook 改写 target
      let best: { prefix: string; upstream: string; exposeHeaders?: boolean } | undefined;
      for (const r of proxy.routes ?? []) {
        if (path.startsWith(r.prefix) && (!best || r.prefix.length > best.prefix.length)) best = r;
      }
      if (best) ctx.target = best.upstream + path + url.search;
      await proxy.hooks?.onResolve?.(ctx);

      // 2. 默认头 + onBuildRequest（可改写 headers/target/body）
      for (const h of ["Accept", "Accept-Encoding", "Content-Type", "Range"]) {
        const v = request.headers.get(h);
        if (v) ctx.headers.set(h, v);
      }
      ctx.headers.set("User-Agent", "CloudMirror/4.0");
      if (route.pat) ctx.headers.set("Authorization", `Bearer ${route.pat}`);
      await proxy.hooks?.onBuildRequest?.(ctx);

      // 3. fetch 上游
      const body = ["GET", "HEAD"].includes(request.method) ? undefined : request.body;
      const res = await fetch(ctx.target, { method: request.method, headers: ctx.headers, body, redirect: "manual" });
      ctx.upstream = res;

      // 4. onSend：CORS 头 + 响应改写
      const out = new Headers(res.headers);
      out.set("Access-Control-Allow-Origin", "*");
      if (proxy.exposeHeaders || best?.exposeHeaders) out.set("Access-Control-Expose-Headers", "*");
      out.delete("content-security-policy");
      out.delete("content-security-policy-report-only");
      ctx.response = new Response(res.body, { status: res.status, headers: out });
      await proxy.hooks?.onSend?.(ctx);

      return ctx.response ?? new Response(res.body, { status: res.status, headers: out });
    } catch (err) {
      // 异常降级：hook 抛错不击穿管线（默认 502），onError 可接管
      const handled = await proxy.hooks?.onError?.(ctx, err);
      if (handled) return handled;
      return new Response(JSON.stringify({ error: "proxy failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ============ 搜索配置 (SDK v2 声明式，单端点源无需覆写 doSearch) ============

  /** 搜索管线配置：端点 + 分页模式 + hooks。详情见 docs/architecture.md §2.3 */
  readonly search?: SearchConfig;

  /**
   * 执行搜索。返回 null 表示不支持搜索。pat 由 worker 层从用户 JWT 解析后传入，Provider 可选择性使用以突破速率限制。
   * 默认实现：由 this.search 声明式配置 + defineResultMapping 的 itemsPath/totalPath 驱动。
   */
  async doSearch(query: string, page: number, pageSize: number, pat?: string): Promise<GenericSearchResponse | null> {
    if (!this.search) return null;
    const cfg = this.search;
    const m = this.defineResultMapping();

    const ctx: SearchContext = {
      query,
      page,
      pageSize,
      pat,
      url: new URL(cfg.endpoint),
      headers: { "User-Agent": "CloudMirror/4.0", Accept: "application/json" },
      items: [],
      total: 0,
    };

    try {
      await cfg.hooks?.onBuildRequest?.(ctx);

      const pagination = cfg.pagination ?? "page";
      ctx.url.searchParams.set(cfg.queryParam ?? "q", query);
      if (pagination === "page") {
        if (cfg.pageParam) ctx.url.searchParams.set(cfg.pageParam, String(page));
        ctx.url.searchParams.set(cfg.pageSizeParam ?? "per_page", String(pageSize));
      } else if (pagination === "offset") {
        ctx.url.searchParams.set(cfg.pageSizeParam ?? "per_page", String(pageSize));
        if (cfg.offsetParam) ctx.url.searchParams.set(cfg.offsetParam, String((page - 1) * pageSize));
      } else {
        // token / none：仅页大小，page 恒 1（token 分页无法回溯）
        ctx.url.searchParams.set(cfg.pageSizeParam ?? "per_page", String(pageSize));
      }
      if (cfg.extraParams) {
        for (const [k, v] of Object.entries(cfg.extraParams)) ctx.url.searchParams.set(k, v);
      }
      if (pat) ctx.headers.Authorization = `Bearer ${pat}`;

      const res = await fetch(ctx.url.toString(), { headers: ctx.headers });
      if (!res.ok) return null;

      ctx.data = await res.json() as Record<string, unknown>;
      await cfg.hooks?.onParse?.(ctx);

      const data = ctx.data as Record<string, unknown>;
      ctx.items = (getByPath(data, m.itemsPath) as unknown[]) ?? [];
      ctx.total = (getByPath(data, m.totalPath) as number) ?? ctx.items.length;
      await cfg.hooks?.onMap?.(ctx);

      const results = ctx.items.map((raw: unknown) => this.mapSearchItem(raw));

      // CRIT-2 防护：itemIdField 选择不当导致搜索结果 id 重复（Go 同 module 多 package）。
      // 开发/测试环境 warn 提示，不影响生产返回（见 docs §5.4）。
      if (results.length > 1) {
        const seen = new Set<string>();
        for (const it of results) {
          if (seen.has(it.id)) {
            console.warn(`[${this.id}] duplicate search item id: "${it.id}" — check itemIdField in defineResultMapping()`);
          } else {
            seen.add(it.id);
          }
        }
      }

      return {
        results,
        total: ctx.total,
        page: pagination === "none" ? 1 : page,
        pageSize,
      };
    } catch {
      // 异常降级：搜索失败返回空结果，不拖垮平台
      return null;
    }
  }

  // ============ 配置 getter (必须覆写) ============

  abstract defineResultMapping(): ResultMapping;
  abstract defineResultCard(): ResultCardConfig;
  abstract defineDetail(): DetailConfig;
  abstract defineSetupGuide(): SetupGuideConfig;

  // ============ 可选覆写 ============

  definePopularSearches(): PopularSearch[] { return []; }

  // ============ RenderContract（SDK v2 §5.4） ============

  /** 聚合渲染契约：base 提供统一视图，供前端与校验消费 */
  render(): RenderContract {
    return {
      resultMapping: this.defineResultMapping(),
      resultCard: this.defineResultCard(),
      detail: this.defineDetail(),
      setupGuide: this.defineSetupGuide(),
      popularSearches: this.definePopularSearches(),
      credentialTypes: this.defineCredentialTypes(),
    };
  }

  /** 契约校验：返回违规清单（空数组 = 通过）。测试与运行时同源。 */
  validateContract(): string[] {
    const issues: string[] = [];
    const r = this.render();

    if (!this.meta.name) issues.push("meta.name empty");
    if (!this.meta.description) issues.push("meta.description empty");
    if (!r.detail.infoEndpoint) issues.push("detail.infoEndpoint empty");
    if (r.detail.infoEndpoint.includes("{id}")) issues.push("detail.infoEndpoint must use {target}, not {id}");
    for (const tab of r.detail.tabs) {
      if (!tab.id) issues.push("tab.id empty");
      if (!tab.label) issues.push(`tab ${tab.id} label empty`);
      if (tab.dataSource.endpoint.includes("{id}")) issues.push(`tab ${tab.id} endpoint must use {target}, not {id}`);
    }
    if (!r.setupGuide.summary) issues.push("setupGuide.summary empty");
    if (!r.setupGuide.quickCommand) issues.push("setupGuide.quickCommand empty");
    if (!r.setupGuide.sections.length) issues.push("setupGuide.sections empty");

    // SSRF 防护：代理路由、upstream 与搜索/详情端点必须 https，且 host 不得为 IP/内网保留段
    // （白名单由声明派生，注册期强制校验，见 docs §5.7）
    if (!this.upstream.startsWith("https://")) issues.push(`upstream must be https: ${this.upstream}`);
    if (isSuspiciousHostname(hostOf(this.upstream))) issues.push(`upstream host is internal/IP: ${this.upstream}`);
    for (const rt of this.proxy.routes ?? []) {
      if (!rt.upstream.startsWith("https://")) issues.push(`proxy route ${rt.prefix} upstream must be https: ${rt.upstream}`);
      if (isSuspiciousHostname(hostOf(rt.upstream))) issues.push(`proxy route ${rt.prefix} upstream host is internal/IP: ${rt.upstream}`);
    }
    if (this.search?.endpoint && !this.search.endpoint.startsWith("https://")) {
      issues.push(`search endpoint must be https: ${this.search.endpoint}`);
    }
    if (this.search?.endpoint && isSuspiciousHostname(hostOf(this.search.endpoint))) {
      issues.push(`search endpoint host is internal/IP: ${this.search.endpoint}`);
    }
    if (!r.detail.infoEndpoint.startsWith("https://")) issues.push(`detail.infoEndpoint must be https: ${r.detail.infoEndpoint}`);
    if (isSuspiciousHostname(hostOf(r.detail.infoEndpoint))) issues.push(`detail.infoEndpoint host is internal/IP: ${r.detail.infoEndpoint}`);

    return issues;
  }

  // ============ Docs 声明（SDK v2 §5.5） ============

  /**
   * Provider 文档声明：prose 章节 + 自动派生开关。
   * 默认实现从 defineSetupGuide 派生 prose，自动派生全开。
   * Provider 可覆写以补充 intro/FAQ/排障等散文章节。
   */
  docs(): ProviderDocs {
    const guide = this.defineSetupGuide();
    const sections: DocsSection[] = guide.sections.map((sec) => ({
      title: sec.title,
      markdown: sec.items
        .map((item) => `**${item.label}**\n\n\`\`\`\n${item.value}\n\`\`\``)
        .join("\n\n"),
    }));
    return {
      summary: guide.summary,
      quickStart: { command: guide.quickCommand },
      sections,
      auto: { proxyEndpoints: true, searchApi: true, credentials: true, quickConnects: true },
    };
  }

  /**
   * 详情目标转换 hook。默认原样返回；
   * 需要补全路径的 Provider（如 Docker 官方镜像补全 library/ 前缀）可覆写。
   */
  protected resolveDetailTarget(target: string): string {
    return target;
  }

  /**
   * 声明此 Provider 支持哪些凭据子类型。
   * authMode=none 的公开源默认提供一个可选 token 类型（用于私有库访问）。
   * Docker 类 Provider 可返回 [{ value:"docker", authMode:"basic" }, { value:"ghcr", authMode:"bearer" }, ...]
   */
  defineCredentialTypes(): { value: string; label: string; authMode: "basic" | "bearer" }[] {
    if (this.authMode === "none") return [{ value: this.id, label: this.displayName, authMode: "bearer" as const }];
    return [{ value: this.id, label: this.displayName, authMode: this.authMode }];
  }

  // ============ 内置工具方法 ============

  /**
   * 将上游原始数据映射为 GenericSearchItem。
   * 使用 this.defineResultMapping() 获取字段路径配置。
   */
  mapSearchItem(raw: unknown): GenericSearchItem {
    const m = this.defineResultMapping();
    const stats: Record<string, { value: unknown; label: string; format: "number" | "bytes" | "duration" | "date" | "text" }> = {};

    for (const s of m.fields.stats ?? []) {
      stats[s.key] = {
        value: getByPath(raw, s.path),
        label: s.label,
        format: (s.format as "number" | "bytes" | "duration" | "date" | "text") ?? "text",
      };
    }

    return {
      id: String(getByPath(raw, m.itemIdField ?? "id") ?? crypto.randomUUID()),
      providerType: this.id,
      kind: m.itemKind ?? "generic",
      title: String(getByPath(raw, m.fields.title) ?? ""),
      description: String(getByPath(raw, m.fields.description) ?? ""),
      subtitle: getByPath(raw, m.fields.subtitle ?? "") as string | undefined,
      subtitlePrefix: m.fields.subtitlePrefix,
      author: getByPath(raw, m.fields.author ?? "") as string | undefined,
      url: getByPath(raw, m.fields.url ?? "") as string | undefined,
      stats,
      raw: raw as Record<string, unknown>,
    };
  }

  /** 获取详情页数据（服务端一站式获取，替代前端多次 fetchProxy 调用）。
   *  默认实现：使用 defineDetail() 配置的 infoEndpoint + tabs 各自的 dataSource，
   *  在 Worker 端统一 fetch 并解析，一次性返回全部数据。
   *  Provider 可覆写以处理特殊逻辑（如 GitHub base64 解码）。
   */
  async getDetail(target: string): Promise<DetailData | null> {
    const config = this.defineDetail();
    // 允许 Provider 补全目标（如 Docker 官方镜像 library/ 前缀）
    const epTarget = this.resolveDetailTarget(target);
    const infoEp = config.infoEndpoint.replace(/\{target\}/g, epTarget);

    // ---- 1. 获取 info 数据 ----
    let rawInfo: Record<string, unknown> | null = null;
    try {
      const infoRes = await fetch(infoEp, {
        headers: { "User-Agent": "CloudMirror/4.0", Accept: "application/json" },
      });
      if (infoRes.ok) {
        const text = await infoRes.text();
        try { rawInfo = JSON.parse(text) as Record<string, unknown>; } catch { rawInfo = null; }
      }
    } catch { /* info fetch failed */ }

    const mapping = config.infoMapping;
    const title = rawInfo ? String(getByPath(rawInfo, mapping.title) ?? target) : target;
    const description = rawInfo ? String(getByPath(rawInfo, mapping.description) ?? "") : "";
    const author = mapping.author && rawInfo ? String(getByPath(rawInfo, mapping.author) ?? "") : undefined;
    const stats = mapping.stats?.map((s) => ({
      label: s.label,
      value: rawInfo ? String(getByPath(rawInfo, s.path) ?? "-") : "-",
    }));

    const meta = rawInfo ? extractMeta(rawInfo, target, config.metaFields) : { a: target };
    const url = config.detailUrlTemplate
      ? config.detailUrlTemplate
          .replace(/\{target\}/g, epTarget)
          .replace(/\{g\}/g, meta.g ?? "")
          .replace(/\{a\}/g, meta.a ?? "")
          .replace(/\{version\}/g, meta.version ?? "")
          .replace(/\{v\}/g, meta.v ?? "")
      : `${this.upstream}/${epTarget}`;

    const detail: DetailData = {
      title, description, author, stats,
      quickConnects: config.quickConnects,
      tabs: [],
      meta: { ...meta, url },
    };
    // SDK v2 详情管线 hooks：dctx 贯穿 onTabResolved → onInfoFetched（见 docs §5.3.3）
    const dctx: DetailContext = { target: epTarget, rawInfo, detail };

    // ---- 2. 获取各 Tab 数据 ----
    for (const tabConfig of config.tabs) {
      const ep = tabConfig.dataSource.endpoint.replace(/\{target\}/g, epTarget);
      const isText = tabConfig.dataSource.responseType === "text";
      let data: unknown = null;
      try {
        const tabRes = await fetch(ep, {
          headers: {
            "User-Agent": "CloudMirror/4.0",
            Accept: isText ? "text/plain, text/markdown, text/html" : "application/json",
          },
        });
        if (tabRes.ok) {
          const body = await tabRes.text();
          const raw: unknown = isText ? body : (() => { try { return JSON.parse(body); } catch { return body; } })();
          const resolved = tabConfig.dataSource.responsePath
            ? getByPath(raw, tabConfig.dataSource.responsePath)
            : raw;

          // 显式声明 base64 解码（如 GitHub readme 响应）
          if (!isText && tabConfig.dataSource.decode === "base64" && typeof resolved === "object" && resolved !== null) {
            const obj = resolved as Record<string, unknown>;
            if (obj.content && obj.encoding === "base64") {
              const decoded = decodeBase64Content(String(obj.content));
              data = decoded !== null ? decoded : resolved;
            } else {
              data = resolved;
            }
          } else {
            data = resolved ?? null;
          }
        }
      } catch { /* tab fetch failed, use null data */ }

      const tab: DetailTabData = {
        id: tabConfig.id,
        label: tabConfig.label,
        icon: tabConfig.icon,
        type: tabConfig.type,
        language: tabConfig.language,
        data,
        columns: tabConfig.dataSource.columns,
      };
      detail.tabs.push(tab);
      if (config.hooks?.onTabResolved) await config.hooks.onTabResolved(dctx, tab);
    }

    if (config.hooks?.onInfoFetched) await config.hooks.onInfoFetched(dctx);

    return detail;
  }

  /** 健康检查：HEAD 请求上游根路径 */
  async healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const res = await fetch(this.upstream, { method: "HEAD" });
      return { ok: res.status < 500, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 从原始响应中提取模板插值所需的通用变量（version/v/g/a）。
 * 路径由各 Provider 的 DetailConfig.metaFields 自行声明，base 仅负责解析渲染。
 */
function extractMeta(raw: Record<string, unknown>, fallback: string, fields?: MetaFieldsConfig): Record<string, string> {
  const v = first(raw, normalize(fields?.version));
  return {
    version: v ?? "",
    v: v ?? "",
    g: first(raw, normalize(fields?.g)) ?? "",
    a: first(raw, normalize(fields?.a)) ?? fallback,
  };
}

/** 将单路径或路径数组规范化为数组 */
function normalize(p: string | string[] | undefined): string[] {
  if (!p) return [];
  return Array.isArray(p) ? p : [p];
}

function first(obj: Record<string, unknown>, paths: string[]): string | undefined {
  for (const p of paths) {
    const val = getByPath(obj, p);
    if (val != null && val !== "") return String(val);
  }
  return undefined;
}

/** 从 URL 提取 hostname（非法 URL 返回空串） */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * SSRF 防护：判定 host 是否为内网/IP 字面量（白名单派生前必须过滤，见 docs §5.7）。
 * 拒绝：IP 字面量（含 IPv6）、localhost、内网保留段（10.x / 172.16-31.x / 192.168.x / 127.x / 169.254.x）。
 */
function isSuspiciousHostname(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname.includes(":")) return true; // IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true; // IPv4 字面量
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (/^(10|127|169\.254|192\.168)\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  return false;
}
