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
// 排版：github-markdown-css（markdown-body）；图片已由后端内嵌为 data URL，前端直接渲染。
// ============================================================================

import { useMemo } from "react";
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

/** 组件映射：图片直接渲染（后端已内嵌 data URL / 保留原 URL），统一尺寸规范 */
function makeComponents(): Components {
  return {
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || "");
      const code = String(children).replace(/\n$/, "");
      if (match && code.includes("\n")) {
        return (
          <div className="my-3">
            <CodeBlock code={code} lang={match[1]} title={match[1]} />
          </div>
        );
      }
      return (
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono" {...props}>
          {children}
        </code>
      );
    },
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
    img({ src, alt, ...props }) {
      // data URL（后端内嵌）或保留的绝对 URL 直接渲染；markdown-body 统一 max-width 规范
      return <img src={src} alt={alt} loading="lazy" className="max-w-full h-auto rounded-md" {...props} />;
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
  className = "",
}: {
  content: string;
  className?: string;
}) {
  if (!content) return null;

  const components = useMemo(() => makeComponents(), []);

  // 跳过 YAML frontmatter (HF model cards 常见)
  let cleanContent = content;
  if (cleanContent.startsWith("---\n")) {
    const endIdx = cleanContent.indexOf("\n---", 3);
    if (endIdx !== -1) {
      cleanContent = cleanContent.slice(endIdx + 4).trimStart();
    }
  }

  return (
    <div className={`markdown-body text-sm ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkFrontmatter, remarkMath]}
        remarkRehypeOptions={{ allowDangerousHtml: true }}
        rehypePlugins={[rehypeRaw, rehypeKatex, [rehypeSanitize, README_SCHEMA]]}
        components={components}
      >
        {cleanContent}
      </ReactMarkdown>
    </div>
  );
}
