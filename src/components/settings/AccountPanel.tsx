// ============================================================================
// AccountPanel — 账户设置面板 (个人资料 + 密码单卡片内编辑)
// ============================================================================

import { useState, useRef, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, Check, Pencil, Monitor, LogOut, UserCog } from "lucide-react";
import { auth, clearToken, dispatchAuthEvent } from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

/** 从 UA 字符串中提取简短的浏览器名称 */
function parseBrowserName(ua: string | null): string {
  if (!ua) return "未知设备";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Safari/") && !ua.includes("Chrome")) return "Safari";
  // 截取前 30 字符作为回退
  return ua.split(" ").slice(0, 2).join(" ").slice(0, 30);
}

interface UserInfo {
  id: string;
  username: string;
  hash: string;
  role: string;
  status?: string;
  email?: string | null;
}

interface AccountPanelProps {
  user: UserInfo;
  onUserUpdate: (u: UserInfo) => void;
  onNavigate: (path: string) => void;
}

export default function AccountPanel({ user, onUserUpdate, onNavigate }: AccountPanelProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setEditUsername(user.username);
    setEditEmail(user.email ?? "");
    setNewPw("");
    setConfirmPw("");
    setEditing(true);
    setTimeout(() => editRef.current?.focus(), 50);
  };

  const cancelEdit = () => setEditing(false);

  const saveAll = async () => {
    setSaving(true);
    try {
      const profileChanged = editUsername !== user.username || editEmail !== (user.email ?? "");
      if (profileChanged) {
        const res = await auth.updateProfile({
          username: editUsername !== user.username ? editUsername : undefined,
          email: editEmail !== (user.email ?? "") ? editEmail : undefined,
        });
        onUserUpdate({
          ...user,
          username: res.username ?? user.username,
          email: res.email ?? user.email,
        });
      }

      if (newPw) {
        if (newPw !== confirmPw) {
          toast.error("两次输入的密码不一致");
          setSaving(false);
          return;
        }
        await auth.changePassword(newPw);
      }

      if (!profileChanged && !newPw) {
        setEditing(false);
        return;
      }
      toast.success("已保存");
      setEditing(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = () => {
    toast(
      (t) => (
        <div className="text-sm">
          <p className="mb-2 font-semibold">确定要停用你的账号？</p>
          <p className="text-xs text-muted-foreground mb-3">
            停用后立即登出，CLI 访问失效。数据保留 72h，超期自动清理。
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => toast.dismiss(t.id)}>取消</Button>
            <Button variant="destructive" size="sm" onClick={async () => {
              toast.dismiss(t.id);
              try {
                await auth.deactivate();
                clearToken();
                dispatchAuthEvent();
                onNavigate("/");
              } catch (err) { toast.error((err as Error).message); }
            }}>确认停用</Button>
          </div>
        </div>
      ), { duration: 15000 });
  };

  // ---- 登录控制 ----
  const [sessions, setSessions] = useState<Array<{ id: string; client_ip: string | null; client_ua: string | null; is_current: number; created_at: string }>>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    try {
      const r = await auth.sessions();
      setSessions(r.data || []);
    } catch { /* ignore */ }
    finally { setSessionsLoading(false); }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleRevokeAll = async () => {
    if (!confirm("将吊销所有登录会话（包括当前设备），所有设备将被强制下线。当前设备将获得新令牌。确定继续？")) return;
    try {
      const r = await auth.revokeAll();
      localStorage.setItem("cloudmirror_token", r.token);
      toast.success("所有会话已吊销");
      loadSessions();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleRevokeOne = () => {
    if (!confirm("确定要登出该设备？")) return;
    handleRevokeAll();
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 个人资料 + 密码 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserCog size={16} className="text-primary" />
                个人资料
              </CardTitle>
              <CardDescription>你的账户基本信息与登录密码</CardDescription>
            </div>
            {!editing && (
              <Button variant="outline" size="sm" className="shrink-0" onClick={startEdit}>
                <Pencil size={13} className="mr-1.5" />编辑
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!editing ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm shrink-0">
                  {user.username.charAt(0).toUpperCase()}
                </span>
                <div>
                  <p className="text-sm font-medium">{user.username}</p>
                  <p className="text-xs text-muted-foreground">{user.email || "未设置邮箱"}</p>
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium">登录密码</p>
                  <p className="text-xs text-muted-foreground">········</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label htmlFor="pr-user">用户名</Label>
                <Input id="pr-user" ref={editRef} value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)} minLength={3} maxLength={32} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pr-email">邮箱</Label>
                <Input id="pr-email" type="email" value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)} placeholder="可选" />
              </div>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="pr-pw">新密码</Label>
                <Input id="pr-pw" type="password" value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="留空则不修改" minLength={8} autoComplete="new-password" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pr-pw2">确认新密码</Label>
                <Input id="pr-pw2" type="password" value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="留空则不修改" minLength={8} autoComplete="new-password" />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>取消</Button>
                <Button size="sm" onClick={saveAll} disabled={saving}>
                  <Check size={14} className="mr-1" />{saving ? "保存中..." : "保存"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 登录控制 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Monitor size={16} className="text-primary" />
                登录控制
              </CardTitle>
              <CardDescription>当前账号的有效登录会话</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleRevokeAll}>
              <LogOut size={13} className="mr-1.5" />
              全部登出
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {sessionsLoading ? (
            <div className="space-y-2">
              <div className="h-8 bg-muted rounded animate-pulse" />
              <div className="h-8 bg-muted rounded animate-pulse" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无可用的登录会话。</p>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {parseBrowserName(s.client_ua)}
                      </span>
                      {s.is_current === 1 && (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0 shrink-0">当前</Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {s.client_ip || "未知 IP"} · {s.created_at ? new Date(s.created_at.replace(" ", "T") + "Z").toLocaleString("zh-CN") : ""}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon-xs" onClick={() => handleRevokeOne()}
                    title="登出此设备">
                    <LogOut size={13} className="text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 危险区域 */}
      <Card className="border-destructive/30">
        <CardHeader>
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle size={16} />
            <CardTitle>危险区域</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            停用后立即登出，CLI 访问失效。数据保留 72 小时，可联系管理员在此期间还原。
            超期后数据将被彻底清除且不可恢复。
          </p>
          <Button variant="destructive" onClick={handleDeactivate}>停用我的账号</Button>
        </CardContent>
      </Card>
    </div>
  );
}
