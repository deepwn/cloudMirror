// ============================================================================
// Markdown — react-markdown + full unified pipeline
// ============================================================================
// Pipeline: remarkParse → remarkGfm → remarkFrontmatter → remarkMath
//           → remarkRehype(allowDangerousHtml) → rehypeRaw → rehypeKatex
//           → rehypeSanitize(relaxed schema)
// ============================================================================
// Supports: GFM tables/tasklists/strikethrough, Math (KaTeX), raw HTML in README,
//           YAML frontmatter skip, fenced code blocks with syntax highlighting.
// XSS-safe: rehypeSanitize runs last, all on* handlers & script/iframe stripped.
// 排版：github-markdown-css（markdown-body）。
// 图片：直接渲染原始 URL（相对路径基于 baseUrl 解析；github blob 规范化为 raw），
//       loading="lazy" + onError 占位；超长内容默认限高折叠，可展开。
// ============================================================================

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Options as RehypeSanitizeOptions } from "rehype-sanitize";
import "katex/dist/katex.min.css";
import CodeBlock from "./CodeBlock";

// 自定义 schema：放宽默认限制，允许 README 中常见的 HTML + KaTeX + SVG
const README_SCHEMA: RehypeSanitizeOptions = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "div",
    "span",
    "center",
    "br",
    "hr",
    "font",
    "sub",
    "sup",
    "details",
    "summary",
    "abbr",
    "dfn",
    "kbd",
    "mark",
    "samp",
    "var",
    "bdi",
    "bdo",
    "wbr",
    "picture",
    "source",
    "small",
    "big",
    "map",
    "area",
    "caption",
    "col",
    "colgroup",
    // KaTeX / MathML
    "math",
    "annotation",
    "semantics",
    "merror",
    "mi",
    "mn",
    "mo",
    "mtext",
    "mspace",
    "mstyle",
    "mrow",
    "mfrac",
    "msqrt",
    "mroot",
    "msub",
    "msup",
    "msubsup",
    "munder",
    "mover",
    "munderover",
    "mtable",
    "mtr",
    "mtd",
    "mlabeledtr",
    "mpadded",
    "mphantom",
    "menclose",
    // SVG
    "svg",
    "path",
    "circle",
    "line",
    "rect",
    "polygon",
    "polyline",
    "g",
    "defs",
    "use",
    "text",
    "tspan",
    "title",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": ["className", "style"],
    img: ["src", "alt", "title", "width", "height", "loading", "class", "id", "align"],
    div: ["align", "class", "id", "style"],
    span: ["class", "id", "style"],
    a: ["href", "title", "target", "rel", "class", "id"],
    p: ["align", "class", "id"],
    table: ["class", "id", "align", "border", "cellpadding", "cellspacing", "width"],
    th: ["class", "id", "align", "colspan", "rowspan", "scope", "width"],
    td: ["class", "id", "align", "colspan", "rowspan", "width"],
    tr: ["class", "id", "align"],
    thead: ["class", "id", "align"],
    tbody: ["class", "id", "align"],
    tfoot: ["class", "id", "align"],
    h1: ["class", "id", "align"],
    h2: ["class", "id", "align"],
    h3: ["class", "id", "align"],
    h4: ["class", "id", "align"],
    h5: ["class", "id", "align"],
    h6: ["class", "id", "align"],
    ul: ["class", "id"],
    ol: ["class", "id", "start", "type"],
    li: ["class", "id"],
    hr: ["class", "id"],
    br: ["class", "id"],
    blockquote: ["class", "id"],
    details: ["class", "id", "open"],
    summary: ["class", "id"],
    code: ["class", "id"],
    pre: ["class", "id"],
    picture: ["class", "id"],
    source: ["src", "srcset", "media", "type", "width", "height"],
    caption: ["class", "id", "align"],
    col: ["align", "class", "id", "span", "width"],
    colgroup: ["align", "class", "id", "span", "width"],
    font: ["class", "id", "color", "size"],
    sub: ["class", "id"],
    sup: ["class", "id"],
    math: ["xmlns", "display", "class", "id"],
    annotation: ["encoding"],
    mi: ["mathvariant"],
    mo: ["stretchy", "fence", "form", "lspace", "rspace", "movablelimits"],
    mspace: ["width", "height", "depth"],
    mtable: ["columnalign", "columnspacing", "rowspacing", "rowlines", "columnlines"],
    mtd: ["columnalign", "columnspan", "rowspan"],
    svg: ["xmlns", "viewBox", "width", "height", "class", "id", "fill", "stroke", "stroke-width"],
    path: ["d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"],
    circle: ["cx", "cy", "r", "fill", "stroke"],
    line: ["x1", "y1", "x2", "y2", "stroke", "stroke-width"],
    polygon: ["points", "fill", "stroke"],
    polyline: ["points", "fill", "stroke"],
    text: ["x", "y", "fill", "font-size", "text-anchor"],
    tspan: ["x", "y"],
    use: ["href", "x", "y"],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [
      ...((defaultSchema.protocols as Record<string, string[]>)?.src || ["http", "https"]),
      "data",
    ],
  },
};

/** github blob/raw 页面链接 → raw.githubusercontent.com 直接文件 URL（同后端工具规则） */
function normalizeGithubUrl(src: string): string {
  const blobMatch = src.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/blob\/([^/#?]+)\/(.+)$/);
  if (blobMatch) {
    const [, owner, repo, branch, path] = blobMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.split("?")[0]}`;
  }
  const rawMatch = src.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/raw\/([^/#?]+)\/(.+)$/);
  if (rawMatch) {
    const [, owner, repo, branch, path] = rawMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.split("?")[0]}`;
  }
  return src;
}

/** 将图片 src 解析为可直接加载的绝对 URL（相对基于 baseUrl，github blob 规范化） */
function resolveImageSrc(src: string, baseUrl?: string): string {
  if (!src) return "";
  // 已是绝对 URL 或 data URL：仅做 github blob 规范化
  if (/^(https?:|data:)/i.test(src)) return normalizeGithubUrl(src);
  // 无 baseUrl：保持原样（渲染会失败，onError 兜底）
  if (!baseUrl) return src;
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return src;
  }
}

/**
 * 组件映射。variant:
 * - "github": 详情页外部 markdown（README/model card）——套 .markdown-body，代码块交给
 *   github-markdown-css 原生 pre/code 样式（不再自行包装 CodeBlock），图片 onError 占位。
 * - "docs": 文档页内部生成的 markdown——不套 .markdown-body（避免污染 docs 原有结构），
 *   保留原有 CodeBlock 多行代码框与表格边框样式。
 */
function makeComponents(variant: "github" | "docs", baseUrl?: string): Components {
  const link: Components = {
    a({ href, children, ...props }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2"
          {...props}
        >
          {children}
        </a>
      );
    },
  };

  if (variant === "docs") {
    // docs：保持原有结构（多行代码统一 CodeBlock block 面板 + 表格边框）
    return {
      ...link,
      code({ className, children, ...props }) {
        const match = /language-(\w+)/.exec(className || "");
        const code = String(children).replace(/\n$/, "");
        // 含换行即用 CodeBlock 面板（无语言标注也显示 FileCode + 复制）
        if (code.includes("\n")) {
          return (
            <div className="my-3">
              <CodeBlock code={code} lang={match?.[1]} title={match?.[1]} />
            </div>
          );
        }
        return (
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono" {...props}>
            {children}
          </code>
        );
      },
      table({ children }) {
        return (
          <div className="overflow-x-auto my-3">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        );
      },
      th({ children }) {
        return <th className="border bg-muted px-3 py-1.5 text-left font-semibold">{children}</th>;
      },
      td({ children }) {
        return <td className="border px-3 py-1.5">{children}</td>;
      },
    };
  }

  // github：外部 markdown，代码块交给 markdown-body 原生 pre/code 样式（不覆写 code）
  return {
    ...link,
    img({ src, alt, ...props }) {
      const resolved = resolveImageSrc(src ?? "", baseUrl);
      return (
        <img
          src={resolved}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="max-w-full h-auto rounded-md"
          onError={(e) => {
            // 加载失败：替换为占位，避免破版
            const el = e.currentTarget;
            el.style.display = "none";
            el.insertAdjacentHTML(
              "afterend",
              `<span class="inline-block rounded border border-dashed border-muted px-2 py-1 text-xs text-muted-foreground my-1">图片 · ${alt || "加载失败"}</span>`,
            );
          }}
          {...props}
        />
      );
    },
    table({ children }) {
      // 横向滚动容器，防止宽表格溢出；表格样式由 markdown-body 统一
      return (
        <div className="overflow-x-auto my-3">
          <table>{children}</table>
        </div>
      );
    },
  };
}

export default function Markdown({
  content,
  baseUrl,
  variant = "github",
  className = "",
}: {
  content: string;
  baseUrl?: string;
  /** "github" = 详情页外部 markdown（markdown-body 样式）；"docs" = 文档页内部 markdown（原有结构） */
  variant?: "github" | "docs";
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!content) return null;

  const components = useMemo(() => makeComponents(variant, baseUrl), [variant, baseUrl]);

  // 跳过 YAML frontmatter (HF model cards 常见)
  let cleanContent = content;
  if (cleanContent.startsWith("---\n")) {
    const endIdx = cleanContent.indexOf("\n---", 3);
    if (endIdx !== -1) {
      cleanContent = cleanContent.slice(endIdx + 4).trimStart();
    }
  }

  // 仅 github 变体：超长 README 默认限高折叠，可展开全部
  const isGithub = variant === "github";
  const isLong = isGithub && cleanContent.length > 6000;
  const collapsible = isLong && !expanded;

  return (
    <div className={isGithub ? `markdown-body text-sm ${className}` : `text-sm ${className}`}>
      <div className={collapsible ? "relative max-h-[65vh] overflow-hidden" : undefined}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkFrontmatter, remarkMath]}
          remarkRehypeOptions={{ allowDangerousHtml: true }}
          rehypePlugins={[rehypeRaw, rehypeKatex, [rehypeSanitize, README_SCHEMA]]}
          components={components}
        >
          {cleanContent}
        </ReactMarkdown>
        {collapsible && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-background to-transparent" />
        )}
      </div>
      {isLong && (
        <div className="mt-2 flex justify-center">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-primary hover:underline cursor-pointer"
          >
            {expanded ? "收起" : "展开全部"}
          </button>
        </div>
      )}
    </div>
  );
}
