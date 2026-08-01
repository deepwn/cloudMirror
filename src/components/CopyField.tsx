import type { MouseEventHandler } from "react";
import { Copy, Check } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./ui/input-group";
import { useCopyToClipboard } from "../hooks/use-copy-to-clipboard";

interface CopyFieldProps {
  value: string;
  className?: string;
  inputClassName?: string;
  title?: string;
  ariaLabel?: string;
  onButtonClick?: MouseEventHandler<HTMLButtonElement>;
}

export default function CopyField({
  value,
  className = "",
  inputClassName = "",
  title = "复制",
  ariaLabel = "复制",
  onButtonClick,
}: CopyFieldProps) {
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    onButtonClick?.(event);
    if (event.defaultPrevented) return;
    copy(value);
  };

  return (
    <InputGroup className={`min-w-0 ${className}`.trim()}>
      <InputGroupInput
        type="text"
        readOnly
        value={value}
        className={`font-mono text-sm ${inputClassName}`.trim()}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" title={title} aria-label={ariaLabel} onClick={handleCopy}>
          {copied ? <Check /> : <Copy />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
