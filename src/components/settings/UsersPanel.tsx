// ============================================================================
// UsersPanel — 管理员用户管理 (分页 / 搜索 / 邀请 / 停用 / 还原)
// ============================================================================

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import {
  Search,
  Trash2,
  KeyRound,
  RotateCcw,
  Users,
  Clock,
  Copy,
  MailPlus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  UserPlus,
} from "lucide-react";
import { admin } from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

/* ---------- types ---------- */
interface AdminUser {
  id: string;
  username: string;
  hash: string;
  role: string;
  status: string;
  email: string | null;
  note: string | null;
  deleted_at: string | null;
  created_at: string;
}

interface InviteRow {
  id: string;
  code: string;
  link: string;
  expires_at: string;
  created_at: string;
}

const DELETION_WINDOW_H = 72;
const PAGE_SIZE = 20;

function remainingHours(deletedAt: string | null): number {
  if (!deletedAt) return 0;
  const deadline = new Date(deletedAt).getTime() + DELETION_WINDOW_H * 3600_000;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 3600_000));
}

function expireLabel(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "已过期";
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return `${Math.floor(ms / 60_000)} 分钟后过期`;
  return `${h} 小时后过期`;
}

interface UsersPanelProps {
  currentUserId: string;
}

export default function UsersPanel({ currentUserId }: UsersPanelProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadUsers = useCallback(async (p: number, search?: string) => {
    setLoading(true);
    try {
      const res = await admin.users(p, PAGE_SIZE, search || undefined);
      setUsers(res.data.users || []);
      setTotal(res.data.total ?? 0);
      setPage(res.data.page ?? p);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers(1);
  }, [loadUsers]);

  const loadInvites = () => {
    admin
      .listInvites()
      .then((r) => setInvites(r.data || []))
      .catch(() => {});
  };

  useEffect(() => {
    loadInvites();
  }, []);

  const handleSearch = () => {
    setPage(1);
    loadUsers(1, searchQuery || undefined);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages || loading) return;
    loadUsers(newPage, searchQuery || undefined);
  };

  const handleRestoreUser = async (t: AdminUser) => {
    try {
      await admin.restoreUser(t.id);
      loadUsers(page, searchQuery || undefined);
      toast.success(`${t.username} 已还原`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleInvite = async () => {
    try {
      await admin.invite();
      toast.success("邀请链接已创建！");
      loadInvites();
    } catch {
      toast.error("创建邀请失败");
    }
  };

  const handleCopyInvite = (link: string) => {
    navigator.clipboard.writeText(link);
    toast.success("已复制邀请链接");
  };

  const handleDeleteInvite = async (invite: InviteRow) => {
    try {
      await admin.deleteInvite(invite.id);
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
      toast.success("已删除邀请链接");
    } catch {
      toast.error("删除失败");
    }
  };

  const handleResetPassword = async (t: AdminUser) => {
    try {
      const res = await admin.resetPassword(t.id);
      if (res.data) {
        navigator.clipboard.writeText(res.data.password);
        toast.success(`${t.username} 密码已重置，已复制`);
      }
    } catch {
      toast.error("重置密码失败");
    }
  };

  const handleDeleteUser = (t: AdminUser) => {
    if (t.status === "deleted") {
      toast.error("已被停用");
      return;
    }
    toast(
      (x) => (
        <div className="text-sm">
          <p className="mb-3">
            确定删除 <strong>{t.username}</strong>？
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            数据保留 72h，期间可还原，超期自动清理。
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => toast.dismiss(x.id)}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                toast.dismiss(x.id);
                try {
                  await admin.deleteUser(t.id);
                  loadUsers(page, searchQuery || undefined);
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            >
              确认停用
            </Button>
          </div>
        </div>
      ),
      { duration: 10000 },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Users size={16} />
          用户列表
          {total > 0 && <Badge variant="secondary">{total}</Badge>}
        </h2>
        <Button size="sm" onClick={handleInvite}>
          <MailPlus size={14} className="mr-1.5" />
          创建邀请
        </Button>
      </div>

      {/* 用户列表 Card */}
      <Card>
        <CardContent>
          <div className="flex items-center gap-2 mb-4">
            <Search size={14} className="text-muted-foreground shrink-0" />
            <Input
              placeholder="搜索用户名或邮箱..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <Button variant="outline" size="sm" onClick={handleSearch}>
              搜索
            </Button>
          </div>

          {loading ? (
            <div className="flex flex-col gap-3 py-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <Empty className="py-12">
              <EmptyMedia variant="icon">
                <Users size={16} />
              </EmptyMedia>
              <EmptyTitle>{searchQuery ? "未找到匹配用户" : "暂无用户"}</EmptyTitle>
            </Empty>
          ) : (
            <>
              <div className="max-h-[420px] overflow-y-auto -mx-3 px-3">
                <div className="flex flex-col divide-y">
                  {users.map((u) => {
                    const remain = u.status === "deleted" ? remainingHours(u.deleted_at) : 0;
                    return (
                      <div key={u.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary text-xs font-bold shrink-0">
                          {u.username.charAt(0).toUpperCase()}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{u.username}</span>
                            <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                              {u.role}
                            </Badge>
                            <Badge
                              variant={
                                u.status === "active"
                                  ? "default"
                                  : u.status === "suspended"
                                    ? "secondary"
                                    : "destructive"
                              }
                            >
                              {u.status === "active"
                                ? "活跃"
                                : u.status === "suspended"
                                  ? "停用"
                                  : "已删除"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {u.email || "未设置邮箱"}
                          </p>
                          {u.status === "deleted" && u.deleted_at && (
                            <p className="flex items-center gap-1 text-xs text-destructive mt-0.5">
                              <Clock size={11} />
                              {remain > 0
                                ? `将在 ${remain} 小时后彻底清除`
                                : "已超过保留期，即将清除"}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {u.status === "deleted" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRestoreUser(u)}
                            >
                              <RotateCcw size={13} className="mr-1" />
                              还原
                            </Button>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleResetPassword(u)}
                                title="重置密码"
                              >
                                <KeyRound size={14} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteUser(u)}
                                title={u.id === currentUserId ? "不能停用自己" : "停用用户"}
                                disabled={u.id === currentUserId}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t mt-3">
                  <span className="text-xs text-muted-foreground">
                    第 {page} / {totalPages} 页，共 {total} 条
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => handlePageChange(page - 1)}
                    >
                      <ChevronLeft size={14} />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => handlePageChange(page + 1)}
                    >
                      <ChevronRight size={14} />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 邀请链接（可折叠） */}
      <Collapsible open={inviteOpen} onOpenChange={setInviteOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-medium hover:text-foreground transition-colors">
          <UserPlus size={14} />
          邀请链接
          {invites.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {invites.length}
            </Badge>
          )}
          <ChevronDown
            size={14}
            className={`ml-auto transition-transform duration-200 ${inviteOpen ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-1.5 pt-2">
            {invites.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">暂无有效邀请链接</p>
            ) : (
              invites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center gap-3 rounded-md bg-muted/30 px-3 py-2 hover:bg-muted/50 transition-colors"
                >
                  <span className="text-xs font-mono truncate min-w-0 flex-1">{inv.code}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {expireLabel(inv.expires_at)}
                  </span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleCopyInvite(inv.link)}
                      title="复制链接"
                    >
                      <Copy size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleDeleteInvite(inv)}
                      title="删除邀请"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
