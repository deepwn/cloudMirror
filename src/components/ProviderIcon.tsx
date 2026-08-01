import type { ProviderIconSpec } from "@shared/types";
import type { ComponentType } from "react";
import * as LucideIcons from "lucide-react";
import * as SimpleIcons from "simple-icons";

interface ProviderIconProps {
  icon?: ProviderIconSpec;
  size?: number;
  className?: string;
  /** 强制单色模式：忽略 simple-icons 的品牌色，使用 currentColor */
  monochrome?: boolean;
}

const DefaultIcon = LucideIcons.Box;
type IconComponent = ComponentType<{ size?: number; className?: string }>;

export default function ProviderIcon({
  icon,
  size = 16,
  className,
  monochrome,
}: ProviderIconProps) {
  if (!icon) {
    return <DefaultIcon size={size} className={className} />;
  }

  if (icon.kind === "lucide") {
    const candidate = (LucideIcons as Record<string, unknown>)[icon.name];
    const Icon = typeof candidate === "function" ? (candidate as IconComponent) : DefaultIcon;
    return <Icon size={size} className={className} />;
  }

  if (icon.kind === "simple-icons") {
    const candidate = (SimpleIcons as Record<string, unknown>)[icon.name] as
      | { path: string; title: string; hex: string }
      | undefined;

    if (!candidate?.path) {
      return <DefaultIcon size={size} className={className} />;
    }

    // monochrome prop 覆盖 colored 配置，也覆盖 icon.monochrome
    const useColor = !monochrome && !icon.monochrome && icon.colored;

    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={className}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d={candidate.path}
          fill={useColor ? `#${candidate.hex}` : "currentColor"}
        />
      </svg>
    );
  }

  if (icon.kind === "image") {
    return (
      <img
        src={icon.src}
        alt={icon.alt || "provider icon"}
        width={size}
        height={size}
        className={className}
      />
    );
  }

  return (
    <svg
      viewBox={icon.viewBox}
      width={size}
      height={size}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {icon.paths.map((path, index) => (
        <path
          key={index}
          d={path}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
