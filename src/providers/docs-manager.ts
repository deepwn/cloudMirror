// ============================================================================
// src/providers/docs-manager.ts — DocsManager（SDK v2 §5.5）
// ============================================================================
// 自动派生章节（代理端点表 / 搜索 API / 凭据类型 / 快速连接）+ Provider prose。
// 端点表渲染为镜像域 URL（https://{domain}{prefix}），上游 host 仅用于白名单派生。

import type { ProviderDefinition } from "./_base";
import type { DocsSection, RenderedDocs } from "../shared/types";
import { PLATFORM_API_PREFIX } from "../shared/api";

export interface DocsRenderContext {
  /** 平台域名（如 mirror.example.com）；缺省用 {hash}.{domain} 占位形式 */
  domain?: string;
  /** provider 自身 hash（用于 {hash} 占位替换） */
  hash?: string;
}

/** 渲染 Provider 文档：自动派生章节 + prose 章节 */
export function renderDocs(
  provider: ProviderDefinition,
  ctx: DocsRenderContext = {},
): RenderedDocs {
  const docs = provider.docs();
  const domain = ctx.domain ?? "mirror.example.com";
  const hash = ctx.hash ?? "{hash}";
  const sub = (t: string): string => t.replace(/\{hash\}/g, hash).replace(/\{domain\}/g, domain);

  const autoSections: DocsSection[] = [];
  if (docs.auto?.proxyEndpoints !== false)
    autoSections.push(...deriveProxyEndpoints(provider, domain));
  if (docs.auto?.searchApi !== false) autoSections.push(deriveSearchApi(provider));
  if (docs.auto?.credentials !== false) autoSections.push(deriveCredentials(provider));
  if (docs.auto?.quickConnects !== false) autoSections.push(deriveQuickConnects(provider));

  return {
    providerId: provider.id,
    displayName: provider.displayName,
    summary: docs.summary,
    quickStart: { command: sub(docs.quickStart.command), note: docs.quickStart.note },
    autoSections,
    proseSections: docs.sections.map((s) => ({ title: s.title, markdown: sub(s.markdown) })),
  };
}

// ============================================================================
// 自动派生
// ============================================================================

/** 代理端点表：镜像域 URL（用户可访问），上游 host 仅供调试 */
function deriveProxyEndpoints(provider: ProviderDefinition, domain: string): DocsSection[] {
  const routes = provider.proxy.routes ?? [];
  const rows = routes.length
    ? routes
        .map((r) => `| \`${r.prefix}\` | \`https://${domain}${r.prefix}\` | \`${r.upstream}\` |`)
        .join("\n")
    : `| 默认（全部路径） | \`https://${domain}/\` | \`${provider.upstream}\` |`;
  return [
    {
      title: "代理端点",
      markdown:
        `本源的路径前缀在镜像域上的代理端点（CLI/工具直接请求原 API 路径即命中）：\n\n` +
        `| 路径前缀 | 镜像端点 | 上游 |\n|---|---|---|\n${rows}\n\n` +
        `默认上游：\`${provider.upstream}\``,
    },
  ];
}

/** 搜索 API 说明 */
function deriveSearchApi(provider: ProviderDefinition): DocsSection {
  return {
    title: "搜索 API",
    markdown:
      `- 搜索 API：\`${PLATFORM_API_PREFIX}/search?type=${provider.id}&q=<关键词>\`\n` +
      `- 详情 API：\`${PLATFORM_API_PREFIX}/detail?type=${provider.id}&target=<目标>\``,
  };
}

/** 凭据类型表 */
function deriveCredentials(provider: ProviderDefinition): DocsSection {
  const types = provider.defineCredentialTypes();
  const rows = types.map((t) => `| ${t.value} | ${t.label} | ${t.authMode} |`).join("\n");
  return {
    title: "凭据类型",
    markdown: `| 值 | 标签 | 认证模式 |\n|---|---|---|\n${rows}`,
  };
}

/** 快速连接命令 */
function deriveQuickConnects(provider: ProviderDefinition): DocsSection {
  const qc = provider.defineDetail().quickConnects ?? [];
  const lines = qc.map((q) => `**${q.label}**\n\n\`\`\`\n${q.template}\n\`\`\``).join("\n\n");
  return { title: "快速连接", markdown: lines || "（无）" };
}
