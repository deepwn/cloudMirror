// ============================================================================
// SearchResults — v1.0: 通用搜索结果，所有 Provider 共用
// ============================================================================

import { useSearchParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight, Ellipsis, Search } from "lucide-react";
import * as api from "../lib/api";
import { useSearchProviders, useProvider } from "../hooks/use-provider";
import SearchProviderPicker from "../components/SearchProviderPicker";
import SearchResultCard from "../components/SearchResultCard";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, FieldLabel } from "@/components/ui/field";
import type { GenericSearchItem } from "@shared/types";

const PAGE_SIZE = 25;

export default function SearchResults() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const allProviders = useSearchProviders();

  const q = params.get("q") || "";
  const rawType = params.get("type") || allProviders[0]?.id || "github";
  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
  const activeType = rawType;

  const [inputValue, setInputValue] = useState(q);
  const [results, setResults] = useState<GenericSearchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const cacheRef = useRef<Map<string, { results: GenericSearchItem[]; total: number }>>(new Map());
  const cacheKey = `${q}_${activeType}_${page}`;

  const provider = useProvider(activeType);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  useEffect(() => { setInputValue(q); }, [q]);

  useEffect(() => {
    if (!q) return;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) { setResults(cached.results); setTotal(cached.total); return; }

    setLoading(true);
    api.apiSearch
      .search(q, activeType, page, PAGE_SIZE)
      .then((data: any) => {
        const items = Array.isArray(data?.results) ? data.results : [];
        const t = data?.total ?? items.length;
        setResults(items);
        setTotal(t);
        cacheRef.current.set(cacheKey, { results: items, total: t });
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [q, activeType, page]);

  const handleSearch = (e?: React.FormEvent | React.KeyboardEvent) => {
    if (e && "preventDefault" in e) e.preventDefault();
    const val = inputValue.trim();
    if (!val) return;
    navigate(`/search?q=${encodeURIComponent(val)}&type=${activeType}`);
  };

  const goPage = (p: number) => {
    if (p < 1 || p > totalPages || p === page) return;
    setParams({ q, type: activeType, page: String(p) }, { replace: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const pageRange = useMemo(() => {
    const half = 2;
    let start = Math.max(1, page - half);
    const end = Math.min(totalPages, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    const pages: number[] = [];
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }, [page, totalPages]);

  return (
    <div className="flex flex-col gap-6">
      {/* ──── 复用首页搜索框 ──── */}
      <div className="w-full max-w-3xl mx-auto">
        <Field>
          <FieldLabel htmlFor="results-search" className="sr-only">搜索</FieldLabel>
          <div className="flex items-center gap-3">
            <InputGroup className="h-11 flex-1 rounded-xl bg-background">
              <InputGroupAddon align="inline-start">
                <SearchProviderPicker
                  providers={allProviders}
                  activeId={activeType}
                  onChange={(t) => navigate(`/search?q=${encodeURIComponent(inputValue.trim() || q)}&type=${t}`)}
                />
              </InputGroupAddon>
              <InputGroupInput
                id="results-search"
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSearch(); } }}
                placeholder={provider?.meta.searchLabel || "继续搜索..."}
                className="h-11 text-base"
              />
            </InputGroup>
            <Button
              type="button"
              onClick={() => handleSearch()}
              className="h-11 shrink-0 rounded-xl px-4 sm:px-5"
            >
              <Search size={16} />
              <span className="hidden sm:inline">搜索</span>
            </Button>
          </div>
        </Field>
      </div>

      {!q ? (
        <div className="text-center py-12 text-sm text-muted-foreground">请输入关键词开始搜索</div>
      ) : loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-45" />
                  <Skeleton className="h-3 w-80" />
                </div>
                <Skeleton className="h-4 w-16 shrink-0" />
              </div>
            </div>
          ))}
        </div>
      ) : results.length > 0 ? (
        <>
          <div className="space-y-3 mt-2">
            {results.map((item, i) => (
              <SearchResultCard key={item.id || String(i)} item={item} />
            ))}
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
              <div className="flex items-center justify-center gap-1 pt-4 pb-8">
              <Button variant="ghost" size="icon" disabled={page <= 1} onClick={() => goPage(page - 1)}>
                <ChevronLeft size={16} />
              </Button>
              {pageRange[0] > 1 && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => goPage(1)}>1</Button>
                  {pageRange[0] > 2 && <Ellipsis size={14} className="text-muted-foreground" />}
                </>
              )}
              {pageRange.map((p) => (
                <Button
                  key={p}
                  variant={p === page ? "default" : "ghost"}
                  size="sm"
                  onClick={() => goPage(p)}
                >
                  {p}
                </Button>
              ))}
              {pageRange[pageRange.length - 1] < totalPages && (
                <>
                  {pageRange[pageRange.length - 1] < totalPages - 1 && (
                    <Ellipsis size={14} className="text-muted-foreground" />
                  )}
                  <Button variant="ghost" size="sm" onClick={() => goPage(totalPages)}>
                    {totalPages}
                  </Button>
                </>
              )}
              <Button variant="ghost" size="icon" disabled={page >= totalPages} onClick={() => goPage(page + 1)}>
                <ChevronRight size={16} />
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-12 text-sm text-muted-foreground">未找到与 "{q}" 相关的结果</div>
      )}
    </div>
  );
}
