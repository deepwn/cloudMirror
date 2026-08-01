// ============================================================================
// Docs.tsx — 使用文档（SDK v2: DocsManager 驱动，自动派生章节 + prose）
// ============================================================================

import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight, BookOpen } from "lucide-react";
import { useAllProviders } from "../hooks/use-provider";
import { useUserProviderHash } from "../hooks/use-user-providers";
import { request as api } from "../lib/api";
import ProviderIcon from "../components/ProviderIcon";
import CodeBlock from "../components/CodeBlock";
import Markdown from "../components/Markdown";
import { renderDocs } from "../providers/docs-manager";
import { Empty, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import type { UserProvider } from "@shared/types";

export default function Docs() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const providers = useAllProviders();
  const selected = providers.find((p) => p.id === (id || providers[0]?.id)) || providers[0];
  const { getHash, getDomain, domain } = useUserProviderHash();

  const [hashes, setHashes] = useState<Record<string, string>>({});

  const loadHashes = useCallback(async () => {
    try {
      const r = await api<{ success: boolean; data: UserProvider[] }>("/providers");
      const map: Record<string, string> = {};
      for (const up of r.data) {
        if (up.hash) map[up.provider] = `${up.hash}.${domain}`;
      }
      setHashes(map);
    } catch {
      /* not logged in */
    }
  }, [domain]);

  useEffect(() => {
    loadHashes();
  }, [loadHashes]);

  if (!selected) {
    return (
      <Empty className="py-20">
        <EmptyTitle>暂无文档</EmptyTitle>
        <EmptyDescription>当前没有可用的 Provider 文档</EmptyDescription>
      </Empty>
    );
  }

  const rendered = renderDocs(selected, {
    domain: hashes[selected.id] || getDomain(selected.id),
    hash: getHash(selected.id),
  });

  return (
    <div className="flex h-full -mx-4 sm:-mx-6 lg:-mx-8">
      {/* Left Sidebar — sticky, independent scroll */}
      <aside className="sticky top-0 h-[calc(100svh-3.5rem)] w-55 lg:w-65 shrink-0 overflow-y-auto border-r sidebar-scroll">
        <div className="pt-8 pb-8 px-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
            Providers
          </p>
          <nav className="flex flex-col gap-0.5">
            {providers.map((p) => {
              const active = p.id === selected.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => navigate(`/docs/${p.id}`)}
                  className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors text-left ${
                    active
                      ? "bg-primary/8 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  <ProviderIcon icon={p.meta.icon} size={14} className="shrink-0" />
                  <span className="flex-1 truncate">{p.displayName}</span>
                  {active && <ChevronRight size={14} className="shrink-0 opacity-50" />}
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main Content — scrolls independently */}
      <div className="flex-1 min-w-0 overflow-y-auto content-scroll">
        <div className="px-6 sm:px-10 lg:px-14 py-8 max-w-3xl">
          {/* Header */}
          <div className="mb-10">
            <h1 className="text-2xl font-bold tracking-tight mb-1">{selected.displayName}</h1>
            {selected.meta.name !== selected.displayName && (
              <p className="mb-4 text-sm text-muted-foreground">{selected.meta.name}</p>
            )}
            <div className="rounded-lg border-l-2 border-primary bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
              <BookOpen size={14} className="inline-block mr-1.5 -mt-0.5 opacity-50" />
              {rendered.summary}
            </div>
          </div>

          {/* Quick Start */}
          <section className="mb-10">
            <h2 className="text-lg font-semibold mb-3">快速开始</h2>
            <CodeBlock
              code={rendered.quickStart.command}
              variant="inline"
              ariaLabel={`复制${selected.displayName}快速命令`}
            />
          </section>

          {/* 自动派生章节（代理端点 / 搜索 API / 凭据 / 快速连接） */}
          {rendered.autoSections.map((sec) => (
            <section key={sec.title} className="mb-8">
              <h2 className="text-lg font-semibold mb-3">{sec.title}</h2>
              <Markdown content={sec.markdown} variant="docs" />
            </section>
          ))}

          {/* Provider 手写 prose 章节 */}
          {rendered.proseSections.map((sec) => (
            <section key={sec.title} className="mb-8">
              <h2 className="text-lg font-semibold mb-3">{sec.title}</h2>
              <Markdown content={sec.markdown} variant="docs" />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
