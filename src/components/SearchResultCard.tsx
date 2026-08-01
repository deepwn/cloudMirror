// ============================================================================
// SearchResultCard — v1.0: 模板驱动，所有 Provider 通用
// ============================================================================

import { useNavigate } from "react-router-dom";
import { useProvider } from "../hooks/use-provider";
import { useUserProviderHash } from "../hooks/use-user-providers";
import type { GenericSearchItem } from "@shared/types";
import { fmtNum } from "../lib/format";
import { interpolateTemplate } from "../shared/utils/template";
import {
  Star,
  GitFork,
  Heart,
  Download,
  User,
  Package,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";
import CodeBlock from "./CodeBlock";

// ---- stat label → icon 映射 ----
const STAT_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Stars: Star,
  forks: GitFork,
  Forks: GitFork,
  Pulls: Download,
  pulls: Download,
  Likes: Heart,
  likes: Heart,
};

function resolveStatIcon(label: string): React.ComponentType<{ size?: number; className?: string }> | null {
  // 精确匹配
  if (STAT_ICONS[label]) return STAT_ICONS[label];
  // 模糊匹配：包含关键词
  const lower = label.toLowerCase();
  if (lower.includes("stars")) return Star;
  if (lower.includes("fork")) return GitFork;
  if (lower.includes("like") || lower.includes("赞")) return Heart;
  if (lower.includes("下载") || lower.includes("download") || lower.includes("pull") || lower.includes("pulls"))
    return Download;
  if (lower.includes("作者") || lower.includes("author") || lower.includes("group") || lower.includes("owner"))
    return User;
  if (lower.includes("package") || lower.includes("版本数") || lower.includes("version"))
    return Package;
  return null;
}

// ============================================================================
// 入口
// ============================================================================

export default function SearchResultCard({ item }: { item: GenericSearchItem }) {
  const provider = useProvider(item.providerType);
  const { getHash, getDomain } = useUserProviderHash();
  if (!provider) return null;

  const card = provider.defineResultCard();
  const hash = getHash(item.providerType);
  const domain = getDomain(item.providerType);
  const statValues = Object.fromEntries(
    Object.entries(item.stats).map(([key, stat]) => [key, stat.value]),
  );
  const templateContext: Record<string, unknown> = {
    ...item.raw,
    hash,
    domain,
    title: item.title,
    id: item.id,
    subtitle: item.subtitle ?? "",
    version: item.subtitle ?? "",
    author: item.author ?? "",
    description: item.description,
    url: item.url ?? "",
    stats: statValues,
  };

  const sub = (tpl: string) =>
    interpolateTemplate(tpl, templateContext);

  const getStat = (field: string) => {
    const key = field.startsWith("stats.") ? field.slice(6) : field;
    return item.stats[key];
  };

  const navigate = useNavigate();

  return (
    <Card
      onClick={() => navigate(sub(card.detailLink))}
      className="w-full cursor-pointer text-left transition-shadow hover:shadow-sm"
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span className="truncate shrink-0">{item.title}</span>
              {card.badges?.map((b, i) => {
                // 条件 badge
                if (b.condition) {
                  const { field, operator, value } = b.condition;
                  const fieldVal = field.split(".").reduce((o: any, k) => o?.[k], item.raw);
                  if (operator === "eq" && fieldVal !== value) return null;
                  if (operator === "neq" && fieldVal === value) return null;
                  if (operator === "exists" && fieldVal == null) return null;
                }
                return (
                  <Badge key={i} variant={b.variant as any} className="shrink-0 ml-0.5">
                    {sub(b.text)}
                  </Badge>
                );
              })}
            </h3>
            {card.descriptionShow && item.description && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {item.description}
              </p>
            )}
          </div>

          {card.stats && card.stats.length > 0 && (
            <div className="shrink-0 flex flex-col gap-1 text-xs text-muted-foreground">
              {card.stats.map((s) => {
                const stat = getStat(s.field);
                if (!stat || stat.value == null || Number(stat.value) <= 0) return null;
                const Icon = resolveStatIcon(stat.label);
                return (
                  <div key={s.field} className="flex items-center gap-1.5">
                    {Icon && <Icon size={13} className="shrink-0 text-muted-foreground/60" />}
                    <span className="tabular-nums">{fmtNum(Number(stat.value))}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {card.quickCommands[0] && (
          <CodeBlock
            code={sub(card.quickCommands[0].template)}
            variant="inline"
            className="mt-2"
            inputClassName="text-xs text-muted-foreground"
            ariaLabel={`复制${card.quickCommands[0].label}命令`}
            onButtonClick={(e) => e.stopPropagation()}
          />
        )}
      </CardContent>
    </Card>
  );
}
