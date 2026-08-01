// ============================================================================
// CodeBlock — 带复制按钮的代码块
// ============================================================================
// 用法: <CodeBlock code="echo hello" lang="bash" />
// ============================================================================

import CopyField from "./CopyField";
import CodePanel from "./CodePanel";

interface CodeBlockProps {
  code: string;
  lang?: string;
  className?: string;
  title?: string;
}

export default function CodeBlock({ code, className = "", title }: CodeBlockProps) {
  if (!code.includes("\n")) {
    return <CopyField value={code} className={className} inputClassName="text-xs" />;
  }

  return <CodePanel code={code} title={title || undefined} className={className} />;
}
