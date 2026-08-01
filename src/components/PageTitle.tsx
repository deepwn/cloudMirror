// ============================================================================
// PageTitle — 页面标题（带可选图标和徽章）
// ============================================================================
// 用法: <PageTitle icon={BookOpen} title="文档" />
//       <PageTitle icon={Settings} title="设置" badge="管理员" />
// ============================================================================

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "./ui/badge";

interface PageTitleProps {
  icon?: LucideIcon;
  title: string;
  badge?: ReactNode;
  className?: string;
}

export default function PageTitle({ icon: Icon, title, badge, className = "" }: PageTitleProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      {Icon && <Icon size={20} className="text-muted-foreground" />}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {badge && <Badge>{badge}</Badge>}
    </div>
  );
}
