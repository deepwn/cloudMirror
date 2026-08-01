// ============================================================================
// ProviderManagementPanel — v1.0: 上游管理（集成凭据 + 子域 + 全局令牌）
// ============================================================================

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { RefreshCw, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import * as api from "../../lib/api";
import { credentials } from "../../lib/api";
import { useAllProviders } from "../../hooks/use-provider";
import ProviderIcon from "../ProviderIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import CodeBlock from "../CodeBlock";
import { useUserProviderHash } from "../../hooks/use-user-providers";
import type { UserProvider } from "@shared/types";

// ---- 类型 ----
interface CredentialTypeConfig {
  value: string;
  label: string;
  authMode: "basic" | "bearer";
}

interface CredentialPublic {
  id: string;
  provider: string;
  label: string;
  username: string;
  is_active: boolean;
  last_used_at: string | null;
}

interface UserProviderMap {
  [providerId: string]: UserProvider | undefined;
}

// ---- 主组件 ----
export default function ProviderManagementPanel({ isAdmin }: { isAdmin: boolean }) {
  const providers = useAllProviders();
  const [upMap, setUpMap] = useState<UserProviderMap>({});
  const [allCreds, setAllCreds] = useState<CredentialPublic[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const [upRes, credRes] = await Promise.all([
        api.request<{ success: boolean; data: UserProvider[] }>("/providers"),
        credentials.list(),
      ]);
      const map: UserProviderMap = {};
      for (const up of upRes.data) map[up.provider] = up;
      setUpMap(map);
      setAllCreds(credRes.data || []);
    } catch {
      toast.error("加载 Provider 配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const refreshProviders = async () => {
    const r = await api.request<{ success: boolean; data: UserProvider[] }>("/providers");
    const map: UserProviderMap = {};
    for (const up of r.data) map[up.provider] = up;
    setUpMap(map);
  };

  const refreshCreds = async () => {
    const r = await credentials.list();
    setAllCreds(r.data || []);
  };

  const toggle = async (providerId: string, enabled: boolean) => {
    const endpoint = enabled
      ? `/providers/${providerId}/enable`
      : `/providers/${providerId}/disable`;
    try {
      await api.request(endpoint, { method: "POST" });
      await refreshProviders();
      toast.success(enabled ? "已启用" : "已禁用");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const updatePat = async (providerId: string, pat: string, patUsername?: string) => {
    try {
      await api.request(`/providers/${providerId}/pat`, {
        method: "PUT",
        body: JSON.stringify({ pat, patUsername }),
      });
      toast.success("全局令牌已保存");
      await refreshProviders();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const rotateHash = async (providerId: string) => {
    if (!confirm("轮换子域后旧地址立即失效，确定继续？")) return;
    try {
      await api.request(`/providers/${providerId}/rotate`, { method: "POST" });
      toast.success("子域已轮换");
      await refreshProviders();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const toggleAll = async (enable: boolean) => {
    const targetProviders = enable
      ? providers.filter((p) => !upMap[p.id]?.enabled)
      : providers.filter((p) => upMap[p.id]?.enabled);
    if (targetProviders.length === 0) return;

    try {
      await Promise.all(
        targetProviders.map((p) => {
          const endpoint = enable
            ? `/providers/${p.id}/enable`
            : `/providers/${p.id}/disable`;
          return api.request(endpoint, { method: "POST" });
        }),
      );
      await refreshProviders();
      toast.success(enable ? "已全部启用" : "已全部禁用");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const enabledCount = providers.filter((p) => upMap[p.id]?.enabled).length;
  const allEnabled = enabledCount === providers.length && providers.length > 0;

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {isAdmin && (
        <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
          <div className="text-sm">
            <span className="font-medium">上游开关</span>
            <span className="text-muted-foreground ml-2">
              {enabledCount}/{providers.length} 已启用
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="toggle-all" className="text-xs text-muted-foreground cursor-pointer">
              全部启用
            </Label>
            <Switch
              id="toggle-all"
              checked={allEnabled}
              onCheckedChange={(v) => toggleAll(v)}
            />
          </div>
        </div>
      )}
      {providers.map((provider) => {
        const up = upMap[provider.id];
        const isEnabled = !!up?.enabled;
        const credTypes: CredentialTypeConfig[] = provider.defineCredentialTypes?.() ?? [];
        const credsForProvider = allCreds.filter(
          (c) => credTypes.some((ct) => ct.value === c.provider),
        );

        return (
          <Card key={provider.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <CardTitle className="flex items-center gap-2">
                    <ProviderIcon icon={provider.meta.icon} size={16} className="shrink-0" />
                    <span>{provider.displayName}</span>
                  </CardTitle>
                  <CardDescription>{provider.meta.description}</CardDescription>
                </div>
                {isAdmin && (
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={(v) => toggle(provider.id, v)}
                  />
                )}
              </div>

              {/* 全局令牌（仅管理员 + 已启用） */}
              {isAdmin && isEnabled && (
                <GlobalPatSection
                  authMode={provider.authMode}
                  patUsername={up?.pat_username}
                  onSave={(pat, patUsername) => updatePat(provider.id, pat, patUsername)}
                />
              )}
            </CardHeader>

            {isEnabled && (
              <CardContent className="space-y-5 border-t pt-4">
                <DomainSection
                  hash={up?.hash}
                  onRotate={() => rotateHash(provider.id)}
                />

                <CredentialListSection
                  provider={provider}
                  creds={credsForProvider}
                  onRefresh={refreshCreds}
                />
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ================================================================
// 全局令牌（卡片顶部，仅管理员）
// ================================================================

function GlobalPatSection({
  authMode,
  patUsername: _patUsername,
  onSave,
}: {
  authMode: string;
  patUsername?: string | null;
  onSave: (pat: string, patUsername?: string) => void;
}) {
  const [pat, setPat] = useState("");
  const [username, setUsername] = useState("");

  return (
    <div className="flex items-center gap-2 mt-2">
      <span className="text-xs text-muted-foreground whitespace-nowrap">全局令牌</span>
      {authMode === "basic" && (
        <Input
          className="h-7 text-xs max-w-36"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      )}
      <Input
        className="h-7 text-xs flex-1"
        type="password"
        placeholder={authMode === "basic" ? "Access Token" : authMode === "none" ? "Token (可选，用于私有库)" : "ghp_xxx / hf_xxx"}
        value={pat}
        onChange={(e) => setPat(e.target.value)}
      />
      <Button size="sm" variant="outline" className="h-7 text-xs"
        onClick={() => { if (pat) { onSave(pat, authMode === "basic" ? username : undefined); setPat(""); } }}
        disabled={!pat}>保存</Button>
    </div>
  );
}

// ================================================================
// 子域
// ================================================================

function DomainSection({ hash, onRotate }: { hash?: string; onRotate: () => void }) {
  const { domain } = useUserProviderHash();
  const subdomain = `${hash || "..."}.${domain}`;

  return (
    <div className="space-y-1">
      <Label className="text-xs">专属子域</Label>
      <div className="flex items-center gap-2">
        <CodeBlock code={subdomain} variant="inline" className="flex-1" ariaLabel="复制子域" />
        <Button variant="ghost" size="icon" onClick={onRotate} title="轮换子域">
          <RefreshCw size={14} />
        </Button>
      </div>
    </div>
  );
}

// ================================================================
// 凭据列表
// ================================================================

function CredentialListSection({
  provider,
  creds,
  onRefresh,
}: {
  provider: any;
  creds: CredentialPublic[];
  onRefresh: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const credTypes: CredentialTypeConfig[] = provider.defineCredentialTypes?.() ?? [];

  if (credTypes.length === 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">访问凭据</Label>
        </div>
        <p className="text-xs text-muted-foreground">（可选）暂无凭据，添加用于访问私有库</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">访问凭据</Label>
        <span className="text-[11px] text-muted-foreground">
          {creds.filter((c) => c.is_active).length}/{creds.length} 启用
        </span>
      </div>

      {creds.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {provider.authMode === "none"
            ? "（可选）暂无凭据，添加用于访问私有库"
            : "暂无凭据，点击添加。"}
        </p>
      ) : (
        <div className="space-y-1.5">
          {creds.map((c) => (
            <CredentialItem
              key={c.id}
              cred={c}
              credTypes={credTypes}
              onToggle={async () => {
                try {
                  await credentials.update(c.id, { is_active: !c.is_active });
                  onRefresh();
                } catch { toast.error("操作失败"); }
              }}
              onDelete={() => {
                toast(
                  (t) => (
                    <div className="text-sm">
                      <p className="mb-3">确定删除此凭据？不可撤销。</p>
                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => toast.dismiss(t.id)}>取消</Button>
                        <Button variant="destructive" size="sm" onClick={async () => {
                          toast.dismiss(t.id);
                          try { await credentials.delete(c.id); toast.success("已删除"); onRefresh(); }
                          catch { toast.error("删除失败"); }
                        }}>删除</Button>
                      </div>
                    </div>
                  ), { duration: 8000 });
              }}
            />
          ))}
        </div>
      )}

      <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setDialogOpen(true)}>
        <Plus size={12} className="mr-1" />添加凭据
      </Button>

      <AddCredentialDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        provider={provider}
        credTypes={credTypes}
        onSaved={onRefresh}
      />
    </div>
  );
}

// ---- 凭据行（显示注册源名称） ----
function CredentialItem({
  cred, credTypes, onToggle, onDelete,
}: {
  cred: CredentialPublic;
  credTypes: CredentialTypeConfig[];
  onToggle: () => void;
  onDelete: () => void;
}) {
  const typeLabel = credTypes.find((ct) => ct.value === cred.provider)?.label || cred.provider;

  return (
    <div className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{cred.label || cred.username}</span>
          <Badge variant={cred.is_active ? "default" : "secondary"} className="text-[10px] px-1.5 py-0 shrink-0">
            {cred.is_active ? "启用" : "禁用"}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">{typeLabel}</span>
          {cred.username && cred.username !== "bearer" && (
            <span className="truncate">· {cred.username}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <Button variant="ghost" size="icon-xs" onClick={onToggle} title={cred.is_active ? "禁用" : "启用"}>
          {cred.is_active ? <Power size={13} /> : <PowerOff size={13} />}
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onDelete} title="删除">
          <Trash2 size={13} className="text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}

// ---- 添加凭据对话框（含注册源下拉） ----
function AddCredentialDialog({
  open, onClose, provider, credTypes, onSaved,
}: {
  open: boolean; onClose: () => void;
  provider: any; credTypes: CredentialTypeConfig[]; onSaved: () => void;
}) {
  const [registry, setRegistry] = useState(credTypes[0]?.value ?? "");
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedType = credTypes.find((ct) => ct.value === registry) || credTypes[0];
  const hasMultiType = credTypes.length > 1;
  const authMode = selectedType?.authMode ?? "basic";

  // 切换注册源时重置用户名
  const handleRegistryChange = (v: string) => {
    setRegistry(v);
    setUsername("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret) return;
    setSubmitting(true);
    try {
      await credentials.create({
        provider: registry,
        label,
        username: authMode === "bearer" ? undefined : username,
        secret,
      });
      toast.success("凭据已添加");
      setLabel(""); setUsername(""); setSecret("");
      onClose();
      onSaved();
    } catch (err) {
      toast.error((err as Error).message || "添加失败");
    } finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加 {provider.displayName} 凭据</DialogTitle>
          <DialogDescription>
            {authMode === "basic"
              ? "填写上游用户名与 Token，用于 Basic 认证代理。"
              : "填写访问令牌（PAT），用于 Bearer 认证代理。"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {hasMultiType && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">注册源 *</Label>
              <NativeSelect
                value={registry}
                onChange={(e) => handleRegistryChange(e.target.value)}
                className="w-full"
              >
                {credTypes.map((ct) => (
                  <option key={ct.value} value={ct.value}>{ct.label}</option>
                ))}
              </NativeSelect>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">标签（可选）</Label>
            <Input placeholder="例如: 个人账号" value={label}
              onChange={(e) => setLabel(e.target.value)} />
          </div>
          {authMode === "basic" && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">上游用户名 *</Label>
              <Input placeholder="Docker Hub 用户名" value={username}
                onChange={(e) => setUsername(e.target.value)} required />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">{authMode === "bearer" ? "Token / PAT *" : "Access Token *"}</Label>
            <Input type="password"
              placeholder={authMode === "bearer" ? "ghp_xxx / hf_xxx" : "Access Token"}
              value={secret} onChange={(e) => setSecret(e.target.value)} required />
          </div>
          <Separator />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>取消</Button>
            <Button type="submit" disabled={submitting}>{submitting ? "保存中..." : "保存凭据"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
