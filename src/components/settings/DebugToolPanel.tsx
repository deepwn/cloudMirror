// ============================================================================
// DebugToolPanel — 调试工具（管理员 Postman 式单次请求）
// ============================================================================

import { useState, useCallback } from "react";
import toast from "react-hot-toast";
import { Send, Plus, Trash2, Loader2, Copy, Check, RefreshCw } from "lucide-react";
import { debug, type DebugFetchResult } from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

interface HeaderRow {
  id: number;
  key: string;
  value: string;
}

const DEFAULT_HEADERS: HeaderRow[] = [
  { id: 1, key: "User-Agent", value: "curl/8.0" },
  { id: 2, key: "Accept", value: "*/*" },
];

const STATUS_COLOR: Record<string, string> = {
  "2": "bg-emerald-500/15 text-emerald-400",
  "3": "bg-sky-500/15 text-sky-400",
  "4": "bg-amber-500/15 text-amber-400",
  "5": "bg-red-500/15 text-red-400",
};

export default function DebugToolPanel() {
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<HeaderRow[]>(DEFAULT_HEADERS);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<DebugFetchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const updateHeader = (id: number, field: "key" | "value", val: string) =>
    setHeaders((prev) => prev.map((h) => (h.id === id ? { ...h, [field]: val } : h)));

  const addHeader = () =>
    setHeaders((prev) => [...prev, { id: Date.now(), key: "", value: "" }]);

  const removeHeader = (id: number) => setHeaders((prev) => prev.filter((h) => h.id !== id));

  const send = useCallback(async () => {
    if (!url.trim()) {
      toast.error("请输入请求 URL");
      return;
    }
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const headerObj: Record<string, string> = {};
      for (const h of headers) {
        if (h.key.trim()) headerObj[h.key.trim()] = h.value;
      }
      const res = await debug.fetch({
        method,
        url: url.trim(),
        headers: headerObj,
        body: method === "GET" || method === "HEAD" ? undefined : body || undefined,
      });
      setResult(res.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }, [method, url, headers, body]);

  const copyResult = useCallback(() => {
    if (!result) return;
    navigator.clipboard
      .writeText(JSON.stringify({ ...result, body: undefined, bodyPreview: result.body }, null, 2))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }, [result]);

  const statusBadge = result ? (
    <Badge
      variant="outline"
      className={`font-mono ${STATUS_COLOR[String(result.status)[0]] ?? "bg-muted text-muted-foreground"}`}
    >
      {result.status} {result.statusText || ""}
    </Badge>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* ---- 请求区 ---- */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-muted-foreground">请求</Label>
            <div className="flex gap-2">
              <div className="w-32 shrink-0">
                <Select value={method} onValueChange={(v) => v && setMethod(v)}>
                  <SelectTrigger className="font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => (
                      <SelectItem key={m} value={m} className="font-mono">
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                className="flex-1 font-mono text-xs"
                placeholder="https://www.bing.com/"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                spellCheck={false}
              />
              <Button onClick={send} disabled={sending} className="shrink-0 gap-1.5">
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                发送
              </Button>
            </div>
          </div>

          {/* ---- Headers ---- */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">请求头</Label>
              <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={addHeader}>
                <Plus size={12} /> 添加
              </Button>
            </div>
            {headers.map((h) => (
              <div key={h.id} className="flex items-center gap-2">
                <Input
                  className="h-7 flex-1 font-mono text-xs"
                  placeholder="Header 名"
                  value={h.key}
                  onChange={(e) => updateHeader(h.id, "key", e.target.value)}
                  spellCheck={false}
                />
                <Input
                  className="h-7 flex-1 font-mono text-xs"
                  placeholder="值"
                  value={h.value}
                  onChange={(e) => updateHeader(h.id, "value", e.target.value)}
                  spellCheck={false}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => removeHeader(h.id)}
                  disabled={headers.length <= 1}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            ))}
          </div>

          {/* ---- Body ---- */}
          {method !== "GET" && method !== "HEAD" && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">请求体</Label>
              <Textarea
                className="font-mono text-xs min-h-24"
                placeholder='{"key": "value"} 或原始文本（POST/PUT/PATCH）'
                value={body}
                onChange={(e) => setBody(e.target.value)}
                spellCheck={false}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- 响应区 ---- */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">响应</Label>
              {statusBadge}
              {result && (
                <span className="text-xs text-muted-foreground font-mono">
                  {result.durationMs}ms
                  {result.truncated && " · 已截断(256KB)"}
                </span>
              )}
            </div>
            {result && (
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 text-xs"
                  onClick={copyResult}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "已复制" : "复制"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 text-xs"
                  onClick={() => {
                    setResult(null);
                    setError(null);
                  }}
                >
                  <RefreshCw size={12} /> 清空
                </Button>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-mono text-destructive">
              {error}
            </div>
          )}

          {!result && !error && (
            <div className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
              发送请求后在此查看响应。可用于诊断代理链路、验证上游接口（例：访问自身 /v2/ 或 bing.com）。
            </div>
          )}

          {result && (
            <>
              {Object.keys(result.headers).length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer text-xs text-muted-foreground select-none">
                    响应头（{Object.keys(result.headers).length}）
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted/40 p-3 text-[11px] font-mono leading-relaxed">
                    {Object.entries(result.headers)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join("\n")}
                  </pre>
                </details>
              )}
              <pre className="max-h-104 overflow-auto rounded-md bg-muted/40 p-3 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all">
                {result.body || "(空响应体)"}
              </pre>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
