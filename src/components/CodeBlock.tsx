// ============================================================================
// CodeBlock — 统一代码展示组件（单行/多行，带复制）
// ============================================================================
// variant:
//   - "auto"   （默认）按内容是否含换行自动选择 inline / block
//   - "inline" 单行：只读输入框 + 复制按钮（替代原 CopyField）
//   - "block"  多行：代码面板 + 语言/标题标签 + 复制按钮（替代原 CodePanel）
// 用法:
//   <CodeBlock code="npm install react" />                          // auto → inline
//   <CodeBlock code={multiline} lang="bash" />                      // auto → block
//   <CodeBlock code={single} variant="block" />                     // 强制 block
//   <CodeBlock code="abc" variant="inline" ariaLabel="复制子域" />  // 强制 inline
// ============================================================================

import type { MouseEventHandler } from "react";
import { Copy, Check, FileCode } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "./ui/input-group";
import { useCopyToClipboard } from "../hooks/use-copy-to-clipboard";

export type CodeBlockVariant = "auto" | "inline" | "block";

interface CodeBlockProps {
  /** 展示的代码/命令内容 */
  code: string;
  /** 语言标识（block 模式展示为标签，未来可用于高亮） */
  lang?: string;
  /** 面板标题（block 模式，优先于 lang 展示） */
  title?: string;
  /** 展示模式：auto（默认按换行自动）/ inline / block */
  variant?: CodeBlockVariant;
  className?: string;
  /** inline 模式输入框额外类名 */
  inputClassName?: string;
  /** 复制按钮无障碍标签（inline 模式默认"复制"） */
  ariaLabel?: string;
  /** 复制按钮点击回调（可 stopPropagation 阻止冒泡） */
  onButtonClick?: MouseEventHandler<HTMLButtonElement>;
  /** block 模式最大行数（默认 16，超出滚动） */
  maxRows?: number;
}

export default function CodeBlock({
  code,
  lang,
  title,
  variant = "auto",
  className = "",
  inputClassName = "",
  ariaLabel = "复制",
  onButtonClick,
  maxRows = 16,
}: CodeBlockProps) {
  const { copied, copy } = useCopyToClipboard();

  const isBlock = variant === "block" || (variant === "auto" && code.includes("\n"));

  const handleCopy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    onButtonClick?.(event);
    if (event.defaultPrevented) return;
    copy(code);
  };

  // ---- 单行：只读输入框 + 右侧复制 ----
  if (!isBlock) {
    return (
      <InputGroup className={`h-8 ${className}`.trim()}>
        <InputGroupInput
          type="text"
          readOnly
          value={code}
          className={`font-mono text-sm ${inputClassName}`.trim()}
        />
        {/* 去除 addon 默认 py-2 避免溢出；addon 的 has-[>button]:mr-[-0.275rem]
            负 margin 用内联样式覆盖，统一右缘边距与多行一致 */}
        <InputGroupAddon align="inline-end" className="py-0" style={{ marginRight: 0 }}>
          <InputGroupButton size="icon-xs" title="复制" aria-label={ariaLabel} onClick={handleCopy}>
            {copied ? <Check /> : <Copy />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    );
  }

  // ---- 多行：代码面板 + 头部（左=文件/语言，右=复制），与单行按钮同侧 ----
  const label = title || lang;
  const rows = Math.min(Math.max(code.split("\n").length, 4), maxRows);

  return (
    <InputGroup className={className}>
      <InputGroupTextarea readOnly value={code} className="font-mono text-sm" rows={rows} />
      <InputGroupAddon align="block-start" className="justify-between">
        <span className="flex items-center gap-2">
          {/* size-3.5 = 14px，与复制按钮内图标（size-3 = 12px 图标在 24px 按钮内）视觉协调 */}
          <FileCode className="text-muted-foreground size-3.5" />
          {label && <InputGroupText className="font-mono">{label}</InputGroupText>}
        </span>
        <InputGroupButton
          size="icon-xs"
          className="ml-auto"
          title="复制"
          aria-label={`复制${label || "代码"}`}
          onClick={handleCopy}
        >
          {copied ? <Check /> : <Copy />}
          <span className="sr-only">复制</span>
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
