// ============================================================================
// DetailShell — 详情页统一头部壳
// ============================================================================

import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

interface StatItem {
  icon: ReactNode;
  label: string;
  value: string | number;
}

interface DetailShellProps {
  title: string;
  labels?: ReactNode[];
  author?: string;
  description?: string;
  stats?: StatItem[];
  backLabel?: string;
  /** 快速连接区 — 始终显示在孩子内容上方 */
  quickConnect?: ReactNode;
  children: ReactNode;
}

export default function DetailShell({
  title,
  labels,
  author,
  description,
  stats,
  backLabel = "返回",
  quickConnect,
  children,
}: DetailShellProps) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-6">
      {/* 面包屑返回 */}
      <a
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer w-fit"
      >
        <ArrowLeft size={14} /> {backLabel}
      </a>

      {/* 标题区 */}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold tracking-tight break-all">{title}</h1>
            {labels?.map((l, i) => (
              <span key={i}>{l}</span>
            ))}
          </div>
          {author && <p className="text-xs text-muted-foreground">by {author}</p>}
          {description && (
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{description}</p>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats && stats.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {stats.map((s) => (
            <span key={s.label} className="flex items-center gap-1">
              {s.icon}
              {s.value}
            </span>
          ))}
        </div>
      )}

      {/* 快速连接 */}
      {quickConnect && <div className="flex flex-col gap-3">{quickConnect}</div>}

      {/* 子内容（Tabs 区等） */}
      {children}
    </div>
  );
}
