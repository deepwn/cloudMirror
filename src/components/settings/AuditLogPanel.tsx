// ============================================================================
// AuditLogPanel — 管理员审计日志面板 (内联过滤 + Tooltip 预览 + Sheet 详情)
// ============================================================================

import { useState, useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  X,
  Shield,
  LogIn,
  Key,
  UserPlus,
  UserMinus,
  Settings2,
  Download,
  Hash,
  AlertTriangle,
  Monitor,
  Clock,
  FileText,
  Globe,
  Info,
  Radio,
} from "lucide-react";
import { admin, type AuditLogEntry } from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

/* ---------- 事件中文映射 ---------- */
const EVENT_LABELS: Record<string, string> = {
  login_failed: "登录失败",
  login_success: "登录成功",
  hash_invalid: "无效子域",
  hash_rotated: "子域轮换",
  credential_added: "添加凭据",
  credential_deleted: "删除凭据",
  user_created: "创建用户",
  user_suspended: "用户操作",
  user_deleted: "删除用户",
  user_restored: "还原用户",
  settings_changed: "设置变更",
  password_reset: "密码重置",
  invite_created: "创建邀请",
  proxy_pull: "代理请求",
  brute_blocked: "爆破封禁",
  debug_fetch: "调试请求",
  capture_request: "录制请求",
};

const EVENT_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  login_failed: AlertTriangle,
  login_success: LogIn,
  hash_invalid: Hash,
  hash_rotated: Hash,
  credential_added: Key,
  credential_deleted: Key,
  user_created: UserPlus,
  user_suspended: UserMinus,
  user_deleted: UserMinus,
  user_restored: UserPlus,
  settings_changed: Settings2,
  password_reset: Key,
  invite_created: UserPlus,
  proxy_pull: Download,
  brute_blocked: Shield,
  debug_fetch: Monitor,
  capture_request: Radio,
};

/* ---------- 事件颜色映射 ---------- */
function eventVariant(event: string): "default" | "destructive" | "secondary" | "outline" {
  switch (event) {
    case "login_failed":
    case "hash_invalid":
    case "brute_blocked":
      return "destructive";
    case "login_success":
    case "user_created":
    case "user_restored":
      return "default";
    case "proxy_pull":
    case "capture_request":
      return "secondary";
    case "debug_fetch":
      return "outline";
    default:
      return "outline";
  }
}

/* ---------- 格式化时间 ---------- */
function formatTime(iso: string): string {
  const d = new Date(iso + "Z");
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatFullTime(iso: string): string {
  const d = new Date(iso + "Z");
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** 将 detail 格式化为可读字符串 */
function formatDetail(detail: AuditLogEntry["detail"]): string {
  if (!detail) return "-";
  if (typeof detail === "object") {
    return JSON.stringify(detail, null, 2);
  }
  return String(detail);
}

/* ---------- Props ---------- */
interface AuditLogPanelProps {
  users: Array<{ id: string; username: string }>;
}

export default function AuditLogPanel({ users }: AuditLogPanelProps) {
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(30);
  const [loading, setLoading] = useState(true);
  const [detailRow, setDetailRow] = useState<AuditLogEntry | null>(null);

  const [filterEvent, setFilterEvent] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [filterIp, setFilterIp] = useState("");

  const allEvents = Object.keys(EVENT_LABELS);

  const loaded = useRef(false);

  const load = useCallback(
    async (p?: number) => {
      setLoading(true);
      try {
        const res = await admin.auditLogs({
          page: p ?? page,
          pageSize,
          event: filterEvent || undefined,
          actorId: filterUser || undefined,
          ip: filterIp.trim() || undefined,
        });
        setRows(res.data.rows);
        setTotal(res.data.total);
        setPage(res.data.page);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, filterEvent, filterUser, filterIp],
  );

  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      load(1);
    }
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = !!(filterEvent || filterUser || filterIp);
  const clearFilters = () => {
    setFilterEvent("");
    setFilterUser("");
    setFilterIp("");
  };
  const handleSearch = () => {
    setPage(1);
    load(1);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 过滤栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{total} 条</Badge>

          <Select value={filterEvent} onValueChange={(v) => setFilterEvent(v ?? "")}>
            <SelectTrigger size="sm" className="w-36">
              <SelectValue placeholder="全部事件" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">全部事件</SelectItem>
              {allEvents.map((ev) => (
                <SelectItem key={ev} value={ev}>
                  {EVENT_LABELS[ev] || ev}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterUser} onValueChange={(v) => setFilterUser(v ?? "")}>
            <SelectTrigger size="sm" className="w-36">
              <SelectValue placeholder="全部用户" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">全部用户</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="h-7 w-36 text-[0.8rem] placeholder:text-xs font-mono"
            placeholder="IP…"
            value={filterIp}
            onChange={(e) => setFilterIp(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X size={14} />
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleSearch}>
            筛选
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(page)} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>

      {/* 日志表格 */}
      {loading ? (
        <Card>
          <CardContent className="py-8 flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Empty className="py-12">
          <EmptyMedia variant="icon">
            <FileText size={16} />
          </EmptyMedia>
          <EmptyTitle>{hasFilters ? "没有匹配的审计记录" : "暂无审计日志"}</EmptyTitle>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">事件</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">
                  用户
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">
                  IP
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">信息</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const Icon = EVENT_ICONS[row.event] || Shield;
                const detailText = formatDetail(row.detail);
                const hasDetail = row.detail && detailText !== "-";
                return (
                  <tr key={row.id} className="border-t hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5">
                      <Badge variant={eventVariant(row.event)} className="text-[11px]">
                        <Icon size={12} />
                        {EVENT_LABELS[row.event] || row.event}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                      {row.actorUsername || (row.actorId ? row.actorId.slice(0, 8) + "..." : "-")}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground hidden md:table-cell">
                      {row.actorIp || "-"}
                    </td>
                    <td className="px-3 py-2.5 max-w-40 lg:max-w-60 truncate text-muted-foreground">
                      {hasDetail ? (
                        <button
                          type="button"
                          className="cursor-pointer hover:text-foreground transition-colors inline-flex items-center gap-1 text-left max-w-full"
                          onClick={() => setDetailRow(row)}
                        >
                          <Info size={12} className="shrink-0 text-muted-foreground" />
                          <span className="truncate">
                            {detailText.slice(0, 40)}
                            {detailText.length > 40 ? "…" : ""}
                          </span>
                        </button>
                      ) : (
                        <span className="text-muted-foreground/50">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {formatTime(row.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页 */}
      {total > pageSize && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            第 {page} / {totalPages} 页，共 {total} 条
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => load(page - 1)}>
              <ChevronLeft size={14} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => load(page + 1)}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* 详情抽屉 */}
      <Sheet
        open={!!detailRow}
        onOpenChange={(open) => {
          if (!open) setDetailRow(null);
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-[33.333vw]">
          {detailRow && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {(() => {
                    const I = EVENT_ICONS[detailRow.event] || Shield;
                    return <I size={16} />;
                  })()}
                  {EVENT_LABELS[detailRow.event] || detailRow.event}
                </SheetTitle>
                <SheetDescription>{formatFullTime(detailRow.createdAt)}</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-4 overflow-y-auto px-4">
                {/* 操作者与基本信息 */}
                <div className="rounded-lg border p-3 space-y-2 text-sm">
                  <h4 className="font-medium flex items-center gap-1.5 text-foreground">
                    <UserPlus size={14} /> 操作者与基本信息
                  </h4>
                  <InfoRow
                    icon={FileText}
                    label="用户名"
                    value={
                      detailRow.actorUsername ||
                      (detailRow.actorId ? detailRow.actorId.slice(0, 8) + "…" : "-")
                    }
                  />
                  <InfoRow icon={Globe} label="IP" value={detailRow.actorIp || "-"} />
                  <InfoRow icon={Monitor} label="UA" value={detailRow.actorUa || "-"} />
                  <InfoRow icon={Clock} label="时间" value={formatFullTime(detailRow.createdAt)} />
                  {detailRow.targetType && (
                    <InfoRow icon={FileText} label="目标类型" value={detailRow.targetType} />
                  )}
                  {detailRow.targetId && (
                    <InfoRow icon={FileText} label="目标 ID" value={detailRow.targetId} />
                  )}
                </div>
                {/* 详情 */}
                {detailRow.detail && (
                  <div className="rounded-lg border p-3 space-y-2 text-sm">
                    <h4 className="font-medium flex items-center gap-1.5 text-foreground">
                      <FileText size={14} /> 详细信息
                    </h4>
                    <pre className="text-xs font-mono bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
                      {formatDetail(detailRow.detail)}
                    </pre>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** 详情行小部件 */
function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={13} className="text-muted-foreground shrink-0 mt-0.5" />
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className="font-mono text-xs break-all">{value}</span>
    </div>
  );
}
