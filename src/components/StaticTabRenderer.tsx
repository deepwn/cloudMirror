// ============================================================================
// StaticTabRenderer — v4.1: 纯渲染组件，数据由服务端 getDetail() 预取
// ============================================================================

import type { DetailTabData } from "@shared/types";
import Markdown from "./Markdown";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import CodeBlock from "./CodeBlock";

interface Props {
  tab: DetailTabData;
}

export default function StaticTabRenderer({ tab }: Props) {
  switch (tab.type) {
    case "markdown":
      return <Markdown content={String(tab.data ?? "")} />;

    case "table": {
      const { columns } = tab;
      if (!columns) return <div className="text-center py-8 text-sm text-muted-foreground">无列配置</div>;
      const rows = Array.isArray(tab.data)
        ? tab.data
        : tab.data && typeof tab.data === "object"
          ? Object.values(tab.data as Record<string, unknown>)
          : [];
      if (rows.length === 0) return <div className="text-center py-8 text-sm text-muted-foreground">无数据</div>;

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
                  return <TableCell key={c.field}>{display}</TableCell>;
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    }

    case "keyValue": {
      const obj = tab.data as Record<string, unknown> | undefined;
      if (!obj || Object.keys(obj).length === 0) return <div className="text-center py-8 text-sm text-muted-foreground">无数据</div>;
      return (
        <div className="space-y-1">
          {Object.entries(obj).map(([k, v]) => {
            const display = typeof v === "object" && v !== null
              ? JSON.stringify(v)
              : String(v ?? "-");
            return (
            <div key={k} className="flex items-center gap-3 text-sm">
              <span className="font-mono text-xs text-muted-foreground min-w-40">{k}</span>
              <span>{display}</span>
            </div>
          );})}
        </div>
      );
    }

    case "code": {
      const codeData = typeof tab.data === "object" && tab.data !== null
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
    try { return new Date(String(val)).toLocaleDateString("zh-CN"); }
    catch { return String(val); }
  }
  return String(val);
}
