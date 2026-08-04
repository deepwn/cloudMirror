// ============================================================================
// CapturePanel — 流量录制（构造/调试未知 Provider 的 CLI 请求流程）
// ============================================================================
// 功能：创建会话（echo/challenge/custom/transparent）、复制专属子域、
//       查看录制到的请求序列（请求 + 真实响应）、JSONL 导出、启用/禁用/删除。
// ============================================================================

import { useState, useCallback, useEffect } from "react";
import toast from "react-hot-toast";
import {
  Plus,
  Copy,
  Check,
  Trash2,
  RefreshCw,
  Download,
  Play,
  StopCircle,
  Eye,
  Radio,
} from "lucide-react";
import { capture, type CaptureSession, type CaptureLog } from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const MODE_LABEL: Record<string, string> = {
  echo: "回显",
  challenge: "挑战(OCI)",
  custom: "自定义",
  transparent: "透明转发",
};

function statusColor(s: number | null): string {
  if (s === null) return "bg-muted text-muted-foreground";
  if (s < 300) return "bg-emerald-500/15 text-emerald-400";
  if (s < 400) return "bg-sky-500/15 text-sky-400";
  if (s < 500) return "bg-amber-500/15 text-amber-400";
  return "bg-red-500/15 text-red-400";
}

export default function CapturePanel() {
  const [sessions, setSessions] = useState<CaptureSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ session: CaptureSession; logs: CaptureLog[] } | null>(null);

  // 新建表单
  const [name, setName] = useState("");
  const [mode, setMode] = useState("echo");
  const [targetUpstream, setTargetUpstream] = useState("");
  const [targetAuth, setTargetAuth] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await capture.list();
      setSessions(r.data || []);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = useCallback(async (id: string) => {
    setActiveId(id);
    try {
      const r = await capture.detail(id);
      setDetail({ session: r.data.session, logs: r.data.logs });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, []);

  const createSession = async () => {
    if (mode === "transparent" && !targetUpstream.trim()) {
      toast.error("transparent 模式需要填真实上游地址");
      return;
    }
    try {
      await capture.create({
        name: name || "未命名录制",
        mode,
        target_upstream: targetUpstream.trim() || undefined,
        target_auth: targetAuth.trim() || undefined,
      });
      toast.success("会话已创建");
      setShowCreate(false);
      setName("");
      setTargetUpstream("");
      setTargetAuth("");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const toggleSession = async (s: CaptureSession) => {
    try {
      await capture.update(s.id, { enabled: !s.enabled });
      await load();
      if (activeId === s.id) openDetail(s.id);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const removeSession = async (s: CaptureSession) => {
    if (!confirm(`删除录制会话「${s.name}」及其全部日志？`)) return;
    try {
      await capture.remove(s.id);
      if (activeId === s.id) {
        setActiveId(null);
        setDetail(null);
      }
      await load();
      toast.success("已删除");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copySubdomain = (hash: string) => {
    const domain = window.location.hostname;
    navigator.clipboard
      .writeText(`${hash}.${domain}`)
      .then(() => {
        setCopiedId(hash);
        setTimeout(() => setCopiedId(null), 1500);
      })
      .catch(() => {});
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ---- 说明 ---- */}
      <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground leading-relaxed">
        把未知 CLI 的 registry / base-url 指向录制子域，所有请求会被录制（含真实响应，transparent 模式）。
        用 challenge 摸入口，再用 transparent 走完整流程。导出 JSONL 用于构造 Provider。
      </div>

      {/* ---- 会话列表 ---- */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">录制会话</Label>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={load}>
              <RefreshCw size={12} /> 刷新
            </Button>
            <Button size="sm" className="h-6 gap-1 text-xs" onClick={() => setShowCreate((v) => !v)}>
              <Plus size={12} /> 新建
            </Button>
          </div>
        </div>

        {showCreate && (
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">名称</Label>
                  <Input className="h-7 text-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 docker-pull-test" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">模式</Label>
                  <Select value={mode} onValueChange={(v) => v && setMode(v)}>
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="echo">回显（摸入口）</SelectItem>
                      <SelectItem value="challenge">挑战 401（OCI/Registry）</SelectItem>
                      <SelectItem value="transparent">透明转发（完整流程）</SelectItem>
                      <SelectItem value="custom">自定义</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {mode === "transparent" && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">真实上游 target_upstream</Label>
                    <Input
                      className="h-7 font-mono text-xs"
                      value={targetUpstream}
                      onChange={(e) => setTargetUpstream(e.target.value)}
                      placeholder="https://registry-1.docker.io"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Token 服务器 target_auth（可选，OCI 类）</Label>
                    <Input
                      className="h-7 font-mono text-xs"
                      value={targetAuth}
                      onChange={(e) => setTargetAuth(e.target.value)}
                      placeholder="https://auth.docker.io"
                    />
                  </div>
                </>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowCreate(false)}>
                  取消
                </Button>
                <Button size="sm" className="h-6 gap-1 text-xs" onClick={createSession}>
                  <Radio size={12} /> 创建
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {sessions.length === 0 && !showCreate && (
          <div className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            暂无录制会话。点击「新建」开始录制 CLI 流量。
          </div>
        )}

        {sessions.map((s) => (
          <Card key={s.id} className={activeId === s.id ? "ring-1 ring-primary/30" : ""}>
            <CardContent className="pt-4 pb-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className="font-mono">{MODE_LABEL[s.mode]}</Badge>
                  <span className="text-sm font-medium truncate">{s.name}</span>
                  {!s.enabled && <Badge variant="secondary" className="text-[10px]">已停用</Badge>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={() => openDetail(s.id)}>
                    <Eye size={12} /> 查看
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={() => toggleSession(s)}>
                    {s.enabled ? <StopCircle size={12} /> : <Play size={12} />}
                    {s.enabled ? "停用" : "启用"}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeSession(s)}>
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-muted/50 px-2 py-1 font-mono text-[11px]">
                  {s.hash}.{window.location.hostname}
                </code>
                <Button variant="outline" size="sm" className="h-6 gap-1 text-xs shrink-0" onClick={() => copySubdomain(s.hash)}>
                  {copiedId === s.hash ? <Check size={12} /> : <Copy size={12} />}
                  {copiedId === s.hash ? "已复制" : "复制"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ---- 会话详情：请求序列 ---- */}
      {detail && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">
              请求序列（{detail.logs.length} 条 · 会话 {detail.session.name}）
            </Label>
            <a
              href={capture.exportUrl(detail.session.id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Download size={12} /> 导出 JSONL
            </a>
          </div>

          {detail.logs.length === 0 && (
            <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              尚无请求。把 CLI 指向上面的子域后操作一次，这里会显示完整请求流。
            </div>
          )}

          {detail.logs.map((l) => (
            <Card key={l.id}>
              <CardContent className="pt-3 pb-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge className={statusColor(l.resp_status)}>#{l.seq}</Badge>
                  <Badge variant="secondary" className="font-mono">{l.method}</Badge>
                  <code className="flex-1 truncate font-mono text-xs">{l.path}</code>
                  {l.resp_status !== null && (
                    <Badge variant="outline" className={`font-mono ${statusColor(l.resp_status)}`}>
                      → {l.resp_status}
                    </Badge>
                  )}
                </div>
                {l.resp_body && (
                  <details className="group">
                    <summary className="cursor-pointer text-[11px] text-muted-foreground select-none">
                      真实响应（{l.resp_body.length} 字符）
                    </summary>
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted/40 p-2 text-[10px] font-mono leading-relaxed whitespace-pre-wrap break-all">
                      {l.resp_body}
                    </pre>
                  </details>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
