// ============================================================================
// AccessControlPanel — 黑白名单管理 (独立页面, 2x2 Card 布局)
// ============================================================================

import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { Plus, X, Globe, Monitor, User, ShieldCheck } from "lucide-react";
import { admin } from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

/* ---------- 列表配置 ---------- */

interface ListConfig {
  key: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ size?: number }>;
  placeholder: string;
  color: "rose" | "emerald" | "amber" | "sky";
}

const LISTS: ListConfig[] = [
  {
    key: "ip_whitelist",
    label: "IP 白名单",
    desc: "白名单 IP 免限速和黑名单检查",
    icon: Globe,
    placeholder: "10.0.0.1",
    color: "emerald",
  },
  {
    key: "ip_blacklist",
    label: "IP 黑名单",
    desc: "匹配的 IP 直接返回 403 拒绝访问",
    icon: Globe,
    placeholder: "192.168.1.1",
    color: "rose",
  },
  {
    key: "ua_block",
    label: "UA 黑名单",
    desc: "User-Agent 包含任一关键词即拒绝",
    icon: Monitor,
    placeholder: "bot",
    color: "amber",
  },
  {
    key: "user_blacklist",
    label: "用户黑名单",
    desc: "按用户名封禁，拒绝登录和操作",
    icon: User,
    placeholder: "username",
    color: "sky",
  },
];

const COLOR_MAP: Record<string, { badge: string; border: string; ring: string }> = {
  rose: {
    badge: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
    border: "border-rose-200 dark:border-rose-800",
    ring: "ring-rose-500/20",
  },
  emerald: {
    badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    border: "border-emerald-200 dark:border-emerald-800",
    ring: "ring-emerald-500/20",
  },
  amber: {
    badge: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    border: "border-amber-200 dark:border-amber-800",
    ring: "ring-amber-500/20",
  },
  sky: {
    badge: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
    border: "border-sky-200 dark:border-sky-800",
    ring: "ring-sky-500/20",
  },
};

export default function AccessControlPanel() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    (async () => {
      try {
        const res = await admin.settings();
        const map: Record<string, string> = {};
        (res.data || []).forEach((s: { key: string; value: string }) => {
          map[s.key] = s.value;
        });
        setSettings(map);
        setEditing(map);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const getItems = (key: string): string[] =>
    (editing[key] ?? settings[key] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const handleAdd = (key: string) => {
    const v = (newValues[key] ?? "").trim();
    if (!v) return;
    const items = getItems(key);
    if (items.includes(v)) {
      toast.error("已存在相同条目");
      return;
    }
    setEditing((prev) => ({ ...prev, [key]: [...items, v].join(",") }));
    setNewValues((prev) => ({ ...prev, [key]: "" }));
    setDirty((prev) => new Set(prev).add(key));
  };

  const handleRemove = (key: string, value: string) => {
    setEditing((prev) => ({
      ...prev,
      [key]: getItems(key)
        .filter((v) => v !== value)
        .join(","),
    }));
    setDirty((prev) => new Set(prev).add(key));
  };

  const handleReset = (key: string) => {
    setEditing((prev) => ({ ...prev, [key]: settings[key] ?? "" }));
    setDirty((prev) => {
      const n = new Set(prev);
      n.delete(key);
      return n;
    });
  };

  const handleSave = async () => {
    if (dirty.size === 0) return;
    setSaving(true);
    try {
      const entries = Array.from(dirty).map((key) => ({ key, value: editing[key] ?? "" }));
      await admin.updateSettings(entries);
      setSettings((prev) => {
        const n = { ...prev };
        for (const { key, value } of entries) n[key] = value;
        return n;
      });
      setDirty(new Set());
      toast.success("已保存，30s 内生效");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <Card>
        <CardContent className="py-12 flex items-center justify-center">
          <Skeleton className="h-4 w-48" />
        </CardContent>
      </Card>
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        {LISTS.map((list) => {
          const items = getItems(list.key);
          const colors = COLOR_MAP[list.color];
          const isDirty = dirty.has(list.key);
          const Icon = list.icon;
          return (
            <Card key={list.key} className={isDirty ? `ring-1 ${colors.ring}` : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex size-8 items-center justify-center rounded-md ${colors.badge}`}
                    >
                      <Icon size={16} />
                    </span>
                    <div>
                      <CardTitle className="text-base">{list.label}</CardTitle>
                      <CardDescription className="text-xs">{list.desc}</CardDescription>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-[11px] shrink-0">
                    {items.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className={`min-h-10.5 rounded-lg border ${colors.border} p-2.5`}>
                  {items.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic py-1">暂无条目</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {items.map((item, i) => (
                        <Badge
                          key={i}
                          variant="secondary"
                          className={`gap-1 pr-0.5 text-xs font-mono ${colors.badge}`}
                        >
                          {item}
                          <button
                            type="button"
                            className="ml-0.5 p-0.5 rounded-sm hover:bg-foreground/15 transition-colors"
                            onClick={() => handleRemove(list.key, item)}
                            aria-label={`删除 ${item}`}
                          >
                            <X size={11} />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    className="h-7 text-[0.8rem] font-mono"
                    placeholder={list.placeholder}
                    value={newValues[list.key] ?? ""}
                    onChange={(e) =>
                      setNewValues((prev) => ({ ...prev, [list.key]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAdd(list.key);
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => handleAdd(list.key)}
                  >
                    <Plus size={14} />
                  </Button>
                </div>
                {isDirty && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-amber-500 inline-block" />
                      已修改
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => handleReset(list.key)}
                    >
                      撤销
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center justify-end">
        <Button onClick={handleSave} disabled={saving || dirty.size === 0}>
          <ShieldCheck size={14} className="mr-1.5" />
          {saving ? "保存中..." : "保存黑白名单"}
        </Button>
      </div>
    </div>
  );
}
