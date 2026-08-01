// ============================================================================
// CredentialsPanel — 上游凭据管理 (Provider 卡片 + 对话框)
// ============================================================================

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import {
  Plus,
  Power,
  PowerOff,
  Trash2,
  Container,
  GitBranch,
  Brain,
  CheckCircle2,
  Shield,
  Key,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { credentials } from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/* ---------- data types ---------- */
interface CredentialPublic {
  id: string;
  provider: string;
  label: string;
  username: string;
  is_active: boolean;
  last_used_at: string | null;
}

interface ProviderCredGroup {
  key: string;
  providerId: string; // shared provider meta 的 id
  label: string; // 分组显示名
  aliases: string[]; // 此组的 provider key 列表
  authType: "basic" | "bearer";
}

const PROVIDER_CRED_GROUPS: ProviderCredGroup[] = [
  {
    key: "docker",
    providerId: "docker",
    label: "Docker Hub",
    aliases: ["docker"],
    authType: "basic",
  },
  {
    key: "ghcr",
    providerId: "docker",
    label: "GitHub Container Registry",
    aliases: ["ghcr"],
    authType: "bearer",
  },
  {
    key: "gcr",
    providerId: "docker",
    label: "Google Container Registry",
    aliases: ["gcr"],
    authType: "basic",
  },
  { key: "quay", providerId: "docker", label: "Quay.io", aliases: ["quay"], authType: "basic" },
  {
    key: "k8s",
    providerId: "docker",
    label: "registry.k8s.io",
    aliases: ["k8s"],
    authType: "basic",
  },
  {
    key: "nvcr",
    providerId: "docker",
    label: "NVIDIA Container Registry",
    aliases: ["nvcr"],
    authType: "basic",
  },
  { key: "github", providerId: "github", label: "GitHub", aliases: ["github"], authType: "bearer" },
  {
    key: "hf",
    providerId: "huggingface",
    label: "HuggingFace",
    aliases: ["hf"],
    authType: "bearer",
  },
];

type ProviderIcon = React.ComponentType<{ size?: number; className?: string }>;
const iconMap: Record<string, ProviderIcon> = {
  docker: Container,
  github: GitBranch,
  huggingface: Brain,
};

// ---- 凭据表单对话框 ----
function CredentialDialog({
  open,
  onClose,
  group,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onClose: () => void;
  group: ProviderCredGroup;
  onSubmit: (data: { label: string; username: string; secret: string }) => Promise<void>;
  submitting: boolean;
}) {
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({ label, username, secret });
    setLabel("");
    setUsername("");
    setSecret("");
  };

  const Icon = iconMap[group.providerId] || Key;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon size={16} />
            </div>
            <DialogTitle>{group.label} 凭据</DialogTitle>
          </div>
          <DialogDescription>
            {group.authType === "basic"
              ? "填写上游用户名与 Token，用于 Docker 认证代理。"
              : "填写访问令牌（PAT / Token），用于 API 认证代理。"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">标签（可选）</Label>
            <Input
              placeholder="例如: 个人账号"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          {group.authType === "basic" && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">上游用户名 *</Label>
              <Input
                placeholder="Docker Hub 用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">
              {group.authType === "bearer" ? "Token / PAT *" : "Token / Secret *"}
            </Label>
            <Input
              type="password"
              placeholder={group.authType === "bearer" ? "ghp_xxx 或 hf_xxx" : "Access Token"}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required
            />
            <p className="text-[11px] text-muted-foreground">
              密钥将用 AES-256-GCM 加密后存入数据库，不会明文保存。
            </p>
          </div>
          <Separator />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "保存中..." : "保存凭据"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- 凭据项行 ----
function CredentialItem({
  cred,
  onToggle,
  onDelete,
}: {
  cred: CredentialPublic;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{cred.label || cred.username}</span>
          <Badge
            variant={cred.is_active ? "default" : "secondary"}
            className="text-[10px] px-1.5 py-0 shrink-0"
          >
            {cred.is_active ? "启用" : "禁用"}
          </Badge>
        </div>
        {cred.username && cred.username !== "bearer" && (
          <p className="text-[11px] text-muted-foreground truncate">{cred.username}</p>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggle}
          title={cred.is_active ? "禁用" : "启用"}
        >
          {cred.is_active ? <Power size={13} /> : <PowerOff size={13} />}
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onDelete} title="删除">
          <Trash2 size={13} className="text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}

// ---- 主面板 ----
export default function CredentialsPanel() {
  const [creds, setCreds] = useState<CredentialPublic[]>([]);
  const [credsLoading, setCredsLoading] = useState(true);
  const [dialogGroup, setDialogGroup] = useState<ProviderCredGroup | null>(null);
  const [credSubmitting, setCredSubmitting] = useState(false);

  const loadCredentials = useCallback(() => {
    credentials
      .list()
      .then((r) => setCreds(r.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setCredsLoading(true);
    credentials
      .list()
      .then((r) => setCreds(r.data || []))
      .catch(() => {})
      .finally(() => setCredsLoading(false));
  }, []);

  const handleCredSubmit = async (data: { label: string; username: string; secret: string }) => {
    if (!dialogGroup) return;
    const providerKey = dialogGroup.aliases[0];
    setCredSubmitting(true);
    try {
      await credentials.create({
        provider: providerKey,
        label: data.label,
        username: dialogGroup.authType === "basic" ? data.username : undefined,
        secret: data.secret,
      });
      setDialogGroup(null);
      toast.success("凭据已保存");
      loadCredentials();
    } catch (err) {
      toast.error((err as Error).message || "保存失败");
    } finally {
      setCredSubmitting(false);
    }
  };

  const handleCredDelete = (id: string) => {
    toast(
      (t) => (
        <div className="text-sm">
          <p className="mb-3">确定删除此凭据？此操作不可撤销。</p>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => toast.dismiss(t.id)}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                toast.dismiss(t.id);
                try {
                  await credentials.delete(id);
                  toast.success("已删除");
                  loadCredentials();
                } catch {
                  toast.error("删除失败");
                }
              }}
            >
              删除
            </Button>
          </div>
        </div>
      ),
      { duration: 8000 },
    );
  };

  const handleCredToggle = async (c: CredentialPublic) => {
    try {
      await credentials.update(c.id, { is_active: !c.is_active });
      loadCredentials();
    } catch {
      toast.error("操作失败");
    }
  };

  // ---- 计算统计 ----
  const configuredCount = PROVIDER_CRED_GROUPS.filter((g) =>
    creds.some((c) => g.aliases.includes(c.provider)),
  ).length;
  const totalCount = PROVIDER_CRED_GROUPS.length;

  const [securityOpen, setSecurityOpen] = useState(false);

  // ---- 渲染 ----
  return (
    <div className="flex flex-col gap-6">
      {/* 安全说明 — 默认折叠，仅在空态或配置完成后显示 */}
      {!credsLoading && (
        <Collapsible open={securityOpen} onOpenChange={setSecurityOpen}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="pb-2 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield size={14} className="text-muted-foreground" />
                    <CardTitle className="text-sm">安全说明</CardTitle>
                  </div>
                  <ChevronDown
                    size={14}
                    className={`text-muted-foreground shrink-0 transition-transform ${securityOpen ? "rotate-180" : ""}`}
                  />
                </div>
                <CardDescription className="text-xs">
                  {configuredCount === 0
                    ? "未配置凭据时，所有代理请求以匿名身份发起，可能受上游速率限制。"
                    : `已配置 ${configuredCount}/${totalCount} 个上游源 — 点击展开详情`}
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 text-xs text-muted-foreground space-y-1 border-t">
                <p className="pt-2">
                  • 所有凭据使用 AES-256-GCM 加密存储，密钥仅存在于 Worker Secrets 中。
                </p>
                <p>• 凭据仅在代理请求到达 Worker 后临时解密注入上游，不落盘。</p>
                <p>• 建议使用只读 Token（read-only PAT），按需授予最小权限。</p>
                <p>
                  • 同一上游源配置多个 token 将自动轮询（随机选择），避免单 token 触发速率限制。
                </p>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* 空态警告 */}
      {!credsLoading && configuredCount === 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle size={13} className="shrink-0" />
          未配置凭据时，所有代理请求将以匿名身份发起，可能受上游速率限制。
        </div>
      )}

      {/* Provider 列表 (单列) */}
      {credsLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {PROVIDER_CRED_GROUPS.map((group) => {
            const groupCreds = creds.filter((c) => group.aliases.includes(c.provider));
            const Icon = iconMap[group.providerId] || Key;
            const hasConfigured = groupCreds.length > 0;
            const activeCount = groupCreds.filter((c) => c.is_active).length;

            return (
              <Card key={group.key} className={hasConfigured ? "" : "border-dashed"}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Icon size={14} />
                      </div>
                      <CardTitle className="text-sm">{group.label}</CardTitle>
                    </div>
                    {hasConfigured ? (
                      <CheckCircle2 size={14} className="text-green-500" />
                    ) : (
                      <div className="flex size-5 items-center justify-center rounded-full border text-[10px] text-muted-foreground">
                        !
                      </div>
                    )}
                  </div>
                  <CardDescription className="text-xs">
                    {group.authType === "basic" ? "用户名 + Token" : "Bearer Token"}
                    {hasConfigured && ` · ${activeCount}/${groupCreds.length} 启用`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  {groupCreds.map((c) => (
                    <CredentialItem
                      key={c.id}
                      cred={c}
                      onToggle={() => handleCredToggle(c)}
                      onDelete={() => handleCredDelete(c.id)}
                    />
                  ))}
                  {groupCreds.length < 2 && (
                    <Button
                      variant={hasConfigured ? "ghost" : "outline"}
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => setDialogGroup(group)}
                    >
                      <Plus size={12} className="mr-1" />
                      {hasConfigured ? "添加另一个" : `配置 ${group.label} 凭据`}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 凭据添加对话框 */}
      {dialogGroup && (
        <CredentialDialog
          open={!!dialogGroup}
          onClose={() => setDialogGroup(null)}
          group={dialogGroup}
          onSubmit={handleCredSubmit}
          submitting={credSubmitting}
        />
      )}
    </div>
  );
}
