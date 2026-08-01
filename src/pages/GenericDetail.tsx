// ============================================================================
// GenericDetail — v1.0: 通用详情页，所有 Provider 共用
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useProvider } from "../hooks/use-provider";
import { useUserProviderHash } from "../hooks/use-user-providers";
import { apiDetail } from "../lib/api";
import type { DetailData } from "@shared/types";
import { interpolateTemplate } from "../shared/utils/template";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import CodeBlock from "@/components/CodeBlock";
import ProviderIcon from "@/components/ProviderIcon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StaticTabRenderer from "@/components/StaticTabRenderer";

export default function GenericDetail() {
  const [sp] = useSearchParams();
  const type = sp.get("type") ?? "";
  const target = sp.get("target") ?? "";

  const provider = useProvider(type);

  if (!provider) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Provider 未找到: {type}</p>
      </div>
    );
  }

  return <DetailContent type={type} target={target} />;
}

// ================================================================

function DetailContent({ type, target }: { type: string; target: string }) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("");
  const navigate = useNavigate();
  const { getHash, getDomain } = useUserProviderHash();
  const hash = getHash(type);
  const domain = getDomain(type);
  const provider = useProvider(type);

  // 追踪上一个 tab：渲染期间 ref 仍是旧值、activeTab 已是新值，
  // 据此判断切换方向 → 前进(右滑入) / 后退(左滑入)；首次/未知方向时仅淡入
  const prevTabRef = useRef<string>("");
  const tabIds = detail?.tabs.map((t) => t.id) ?? [];
  const prevTabIdx = tabIds.indexOf(prevTabRef.current);
  const activeTabIdx = tabIds.indexOf(activeTab);
  const tabDirection =
    prevTabIdx === -1 || activeTabIdx === -1
      ? null
      : activeTabIdx > prevTabIdx
        ? "right"
        : "left";

  // 渲染完成后同步参考值，供下一次切换比较
  useEffect(() => {
    if (prevTabRef.current !== activeTab) prevTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiDetail
      .get(type, target)
      .then((data) => {
        setDetail(data);
        if (data.tabs?.[0]?.id) setActiveTab(data.tabs[0].id);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [type, target]);

  // 模板插值
  const sub = (tpl: string) => {
    const ctx: Record<string, unknown> = {
      hash,
      domain,
      target,
      title: detail?.title ?? target,
      description: detail?.description ?? "",
      author: detail?.author ?? "",
      ...detail?.meta,
    };
    return interpolateTemplate(tpl, ctx);
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">加载失败: {error || "未知错误"}</p>
        <button onClick={() => navigate(-1)} className="text-sm text-primary hover:underline cursor-pointer">
          返回
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <a
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer w-fit"
      >
        <ArrowLeft size={14} /> 返回
      </a>

      {/* ──── 标题区：icon + 名称/作者 + 源链接 ──── */}
      <div className="flex items-start gap-3">
        {provider && (
          <ProviderIcon icon={provider.meta.icon} size={40} className="shrink-0 mt-1" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight break-all">{detail.title}</h1>
          {detail.author && <p className="text-xs text-muted-foreground mt-0.5">by {detail.author}</p>}
          {detail.description && (
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{detail.description}</p>
          )}
        </div>
        {provider && (
          <a
            href={detail.meta?.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0"
          >
            <Button variant="outline" size="sm" className="gap-1.5">
              打开源页面
              <ExternalLink size={14} />
            </Button>
          </a>
        )}
      </div>

      {detail.stats && detail.stats.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {detail.stats.map((s) => (
            <span key={s.label}>{s.label}: {s.value}</span>
          ))}
        </div>
      )}

      {detail.quickConnects && detail.quickConnects.length > 0 && (
        <div className="flex flex-col gap-2">
          {detail.quickConnects.map((qc, i) => (
            <CodeBlock key={i} code={sub(qc.template)} variant="inline" ariaLabel={`复制${qc.label}命令`} />
          ))}
        </div>
      )}

      {detail.tabs.length > 0 && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList variant="line" className="w-fit">
            {detail.tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5">
                {tab.icon && <ProviderIcon icon={tab.icon} size={14} />}
                <span>{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          {detail.tabs.map((tab) => (
            <TabsContent
              key={tab.id}
              value={tab.id}
              // tab 切换：按方向水平滑入 + 淡入（前进=右侧进入，后退=左侧进入）
              className={
                tabDirection === "right"
                  ? "animate-in fade-in slide-in-from-right-2 duration-200 ease-out"
                  : tabDirection === "left"
                    ? "animate-in fade-in slide-in-from-left-2 duration-200 ease-out"
                    : "animate-in fade-in duration-200 ease-out"
              }
            >
              <StaticTabRenderer tab={tab} hash={hash} domain={domain} target={target} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
