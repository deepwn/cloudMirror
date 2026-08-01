import { Copy, Check, FileCode } from "lucide-react";
import { useCopyToClipboard } from "../hooks/use-copy-to-clipboard";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "./ui/input-group";

interface CodePanelProps {
  code: string;
  title?: string;
  className?: string;
}

export default function CodePanel({ code, title, className = "" }: CodePanelProps) {
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = () => copy(code);

  return (
    <InputGroup className={className}>
      <InputGroupTextarea
        readOnly
        value={code}
        className="font-mono text-sm"
        rows={Math.min(Math.max(code.split("\n").length, 4), 16)}
      />
      <InputGroupAddon align="block-start">
        <FileCode className="text-muted-foreground" />
        {title && <InputGroupText className="font-mono">{title}</InputGroupText>}
        <InputGroupButton
          size="icon-xs"
          className="ml-auto"
          title="复制"
          aria-label={`复制${title || "代码"}`}
          onClick={handleCopy}
        >
          {copied ? <Check /> : <Copy />}
          <span className="sr-only">复制</span>
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
