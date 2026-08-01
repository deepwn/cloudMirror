// ============================================================================
// StaticTabRenderer — v4.2: 纯渲染组件，数据由服务端 getDetail() 预取
// ============================================================================

import { useState } from "react";
import { ChevronRight, Download, FileArchive, FileCode } from "lucide-react";
import type { DetailTabData } from "@shared/types";
import Markdown from "./Markdown";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import CodeBlock from "./CodeBlock";
import { Badge } from "./ui/badge";

interface Props {
  tab: DetailTabData;
  /** 用户专属子域（未登录为 "{hash}" 占位符） */
  hash?: string;
  /** 平台域名 */
  domain?: string;
  /** 详情目标（如 github owner/repo），用于构造代理下载链接 */
  target?: string;
}

export default function StaticTabRenderer({ tab, hash, domain, target }: Props) {
  switch (tab.type) {
    case "markdown":
      // github 变体：外部 markdown 用 github-markdown-css（markdown-body）排版
      return <Markdown content={String(tab.data ?? "")} baseUrl={tab.baseUrl} variant="github" />;

    case "releases":
      return <ReleasesTab data={tab.data} hash={hash} domain={domain} target={target} />;

    case "table": {
      const { columns } = tab;
      if (!columns)
        return <div className="text-center py-8 text-sm text-muted-foreground">无列配置</div>;
      const rows = Array.isArray(tab.data)
        ? tab.data
        : tab.data && typeof tab.data === "object"
          ? Object.values(tab.data as Record<string, unknown>)
          : [];
      if (rows.length === 0)
        return <div className="text-center py-8 text-sm text-muted-foreground">无数据</div>;

      return (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.field}>{c.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row: any, i: number) => (
              <TableRow key={i}>
                {columns.map((c) => {
                  const val = resolvePath(row, c.field);
                  const display = formatCellValue(val, c.format, c.emptyText);
                  // URL 值渲染为可点击链接（target=_blank），如 release 资产下载链接
                  const isUrl = typeof val === "string" && /^https?:\/\//i.test(val);
                  return (
                    <TableCell key={c.field}>
                      {isUrl ? (
                        <a
                          href={val}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline underline-offset-2 break-all"
                        >
                          {display}
                        </a>
                      ) : (
                        display
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    }

    case "keyValue": {
      const obj = tab.data as Record<string, unknown> | undefined;
      if (!obj || Object.keys(obj).length === 0)
        return <div className="text-center py-8 text-sm text-muted-foreground">无数据</div>;
      return (
        <div className="space-y-1">
          {Object.entries(obj).map(([k, v]) => {
            const display =
              typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "-");
            return (
              <div key={k} className="flex items-center gap-3 text-sm">
                <span className="font-mono text-xs text-muted-foreground min-w-40">{k}</span>
                <span>{display}</span>
              </div>
            );
          })}
        </div>
      );
    }

    case "code": {
      const codeData =
        typeof tab.data === "object" && tab.data !== null
          ? JSON.stringify(tab.data, null, 2)
          : String(tab.data ?? "");
      return <CodeBlock code={codeData} lang={tab.language ?? "text"} />;
    }

    default:
      return <pre className="text-xs overflow-auto">{JSON.stringify(tab.data, null, 2)}</pre>;
  }
}

// ---- 内联工具（与旧 TabRenderer 一致） ----

function resolvePath(obj: unknown, path: string): unknown {
  if (!path || obj == null) return undefined;
  const segs = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cur: unknown = obj;
  for (const s of segs) {
    if (!s) continue;
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}

function formatCellValue(val: unknown, format?: string, emptyText?: string): string {
  if (val == null) return emptyText ?? "-";
  if (format === "bytes") {
    const n = Number(val);
    if (isNaN(n)) return String(val);
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  }
  if (format === "number") return Number(val).toLocaleString();
  if (format === "date") {
    try {
      return new Date(String(val)).toLocaleDateString("zh-CN");
    } catch {
      return String(val);
    }
  }
  return String(val);
}

// ═══════════════════════════════════════════════════════════════════════════
// ReleasesTab — GitHub release 列表（可折叠 + 资产文件 + 代理下载）
// ═══════════════════════════════════════════════════════════════════════════

interface ReleaseAsset {
  name?: string;
  size?: number;
  browser_download_url?: string;
}

interface ReleaseRow {
  id?: number | string;
  tag_name?: string;
  name?: string;
  published_at?: string;
  assets?: ReleaseAsset[];
  draft?: boolean;
  prerelease?: boolean;
}

/** 格式化字节 */
function formatBytes(n: number): string {
  if (isNaN(n)) return "-";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

function ReleasesTab({
  data,
  hash,
  domain,
  target,
}: {
  data: unknown;
  hash?: string;
  domain?: string;
  target?: string;
}) {
  const rows = (Array.isArray(data) ? data : []) as ReleaseRow[];
  const [expandedId, setExpandedId] = useState<number | string | null>(null);

  if (rows.length === 0) {
    return <div className="text-center py-8 text-sm text-muted-foreground">无 Release</div>;
  }

  // 未登录：hash 为 "{hash}" 占位符 → 下载禁用（灰色不可点击）
  const loggedIn = Boolean(hash && !hash.includes("{") && target);

  return (
    <div className="flex flex-col gap-2">
      {rows.map((rel) => {
        const id = rel.id ?? rel.tag_name ?? "";
        const isOpen = expandedId === id;
        const assets = rel.assets ?? [];

        return (
          <div key={id} className="rounded-lg border">
            {/* 版本行：点击展开/收起 */}
            <button
              type="button"
              onClick={() => setExpandedId(isOpen ? null : id)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors cursor-pointer"
            >
              <span className="flex min-w-0 items-center gap-2">
                <ChevronRight
                  size={14}
                  className={`shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
                <span className="truncate font-mono text-sm font-medium">{rel.tag_name}</span>
                {rel.prerelease && (
                  <Badge variant="secondary" className="text-[10px]">
                    预发布
                  </Badge>
                )}
                {rel.name && rel.name !== rel.tag_name && (
                  <span className="truncate text-xs text-muted-foreground">{rel.name}</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {rel.published_at && <span>{formatCellValue(rel.published_at, "date")}</span>}
              </span>
            </button>

            {/* 资产文件列表：展开时显示 */}
            {isOpen && (
              <div className="animate-in fade-in slide-in-from-top-1 duration-200 ease-out border-t px-3 py-2">
                {/* GitHub 自动生成的源码包：任何 tag 都可下载（zip / tar.gz） */}
                <div className="flex flex-col">
                  {["zip", "tar.gz"].map((ext) => {
                    const srcName = `Source code (${ext})`;
                    // 代理源码包链接：https://{hash}.{domain}/{target}/archive/refs/tags/{tag}.{ext}
                    // 子域代理不命中 /raw|/api|/repos 前缀 → 走默认 upstream（github.com）原样拼接，恰好是官方源码包地址
                    const srcUrl =
                      loggedIn && rel.tag_name
                        ? `https://${hash}.${domain}/${target}/archive/refs/tags/${encodeURIComponent(rel.tag_name)}.${ext}`
                        : "";
                    return loggedIn ? (
                      <a
                        key={ext}
                        href={srcUrl}
                        title="通过代理下载源码包"
                        className="flex items-center justify-between gap-3 border-b py-1.5 last:border-b-0 hover:bg-muted/50 transition-colors"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <FileCode size={13} className="shrink-0 text-muted-foreground" />
                          <span className="truncate text-xs font-mono">{srcName}</span>
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                          <Download size={11} /> 下载
                        </span>
                      </a>
                    ) : (
                      <span
                        key={ext}
                        title="登录后可下载"
                        className="flex cursor-not-allowed items-center justify-between gap-3 border-b py-1.5 last:border-b-0"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <FileCode size={13} className="shrink-0 text-muted-foreground" />
                          <span className="truncate text-xs font-mono">{srcName}</span>
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground/50">
                          <Download size={11} /> 下载
                        </span>
                      </span>
                    );
                  })}
                </div>

                {/* Release 实际资产文件 */}
                {assets.length > 0 && (
                  <div className="border-t mt-1 pt-1">
                    {assets.map((a, i) => {
                      const fileName = a.name ?? "";
                      // 代理下载链接：https://{hash}.{domain}/{target}/releases/download/{tag}/{file}
                      const proxyUrl =
                        loggedIn && rel.tag_name
                          ? `https://${hash}.${domain}/${target}/releases/download/${encodeURIComponent(rel.tag_name)}/${encodeURIComponent(fileName)}`
                          : "";
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-3 border-b py-1.5 last:border-b-0"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <FileArchive size={13} className="shrink-0 text-muted-foreground" />
                            <span className="truncate text-xs font-mono">{fileName}</span>
                            {a.size != null && (
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {formatBytes(a.size)}
                              </span>
                            )}
                          </span>
                          {loggedIn ? (
                            <a
                              href={proxyUrl}
                              title="通过代理下载"
                              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                            >
                              <Download size={11} /> 下载
                            </a>
                          ) : (
                            <span
                              title="登录后可下载"
                              className="inline-flex shrink-0 cursor-not-allowed items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground/50"
                            >
                              <Download size={11} /> 下载
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
