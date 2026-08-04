// ============================================================================
// Settings.tsx — 设置页面 (GitHub-style sidebar layout)
// ============================================================================

import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import {
  X,
  Menu,
  Users,
  UserCog,
  Settings2,
  FileText,
  Shield,
  Package,
  Container,
  FlaskConical,
} from "lucide-react";
import { auth, admin, getStoredUser } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import AccountPanel from "../components/settings/AccountPanel";
import ProviderManagementPanel from "../components/settings/ProviderManagementPanel";
import UsersPanel from "../components/settings/UsersPanel";
import SecurityPanel from "../components/settings/SecurityPanel";
import AccessControlPanel from "../components/settings/AccessControlPanel";
import AuditLogPanel from "../components/settings/AuditLogPanel";
import BackupPanel from "../components/settings/BackupPanel";
import DebugToolPanel from "../components/settings/DebugToolPanel";
import CapturePanel from "../components/settings/CapturePanel";

/* ---------- nav sections ---------- */
type NavSection =
  | "account"
  | "providers"
  | "users"
  | "settings"
  | "access"
  | "audit"
  | "backup"
  | "debug";

interface NavItem {
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: "account", label: "账户信息", icon: UserCog },
  { id: "providers", label: "上游管理", icon: Container },
  { id: "settings", label: "系统设置", icon: Settings2, adminOnly: true },
  { id: "users", label: "用户管理", icon: Users, adminOnly: true },
  { id: "access", label: "黑白名单", icon: Shield, adminOnly: true },
  { id: "audit", label: "审计日志", icon: FileText, adminOnly: true },
  { id: "debug", label: "调试工具", icon: FlaskConical, adminOnly: true },
  { id: "backup", label: "配置备份", icon: Package, adminOnly: true },
];

/* ---------- admin user type ---------- */
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

export default function Settings() {
  const navigate = useNavigate();

  /* ---- user ---- */
  const [user, setUser] = useState<{
    id: string;
    username: string;
    hash: string;
    role: string;
    status?: string;
    email?: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const isAdmin = user?.role === "admin";

  /* ---- mobile sidebar ---- */
  const [sidebarOpen, setSidebarOpen] = useState(false);

  /* ---- active section ---- */
  const [activeSection, setActiveSection] = useState<NavSection>("account");

  /* ---- 调试工具子 Tab ---- */
  const [debugTab, setDebugTab] = useState<"postman" | "capture">("postman");

  /* ---- audit user list ---- */
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);

  /* ---- load user ---- */
  useEffect(() => {
    const cached = getStoredUser();
    if (cached) setUser(cached);
    auth
      .me()
      .then((u) => {
        setUser({ ...u, email: (u as { email?: string | null }).email });
        localStorage.setItem("cloudmirror_user", JSON.stringify(u));
      })
      .catch(() => {
        if (!getStoredUser()) {
          toast.error("凭据已失效，请重新登录");
          navigate("/");
        }
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  /* ---- load user list for audit filter ---- */
  useEffect(() => {
    if (!isAdmin) return;
    admin
      .users(1, 200)
      .then((r) => setAdminUsers(r?.data?.users || []))
      .catch(() => {});
  }, [isAdmin]);

  /* ---- sidebar nav ---- */
  const navBtnClass = (id: NavSection) =>
    `w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left ${
      activeSection === id
        ? "bg-primary/10 text-primary"
        : "text-muted-foreground hover:text-foreground hover:bg-muted"
    }`;

  const SidebarNav = () => (
    <nav className="flex flex-col gap-1" aria-label="设置导航">
      {NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => (
        <button
          key={item.id}
          type="button"
          className={navBtnClass(item.id)}
          onClick={() => {
            setActiveSection(item.id);
            setSidebarOpen(false);
          }}
        >
          <item.icon size={16} />
          {item.label}
        </button>
      ))}
    </nav>
  );

  /* ---- loading / no-user ---- */
  if (loading)
    return (
      <div className="flex flex-col gap-6 px-4 sm:px-6 lg:px-8 py-8">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-64" />
        <div className="flex flex-col gap-4 mt-4">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      </div>
    );
  if (!user)
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-3">请先登录</p>
          <Button onClick={() => navigate("/")}>前往首页</Button>
        </div>
      </div>
    );

  const panelLabel = NAV_ITEMS.find((n) => n.id === activeSection)?.label ?? "设置";
  const panelDesc: Record<NavSection, string> = {
    account: "管理个人信息、密码与安全设置",
    providers: "管理各上游源的启用、凭据与专属子域",
    users: "管理平台用户与邀请",
    settings: "系统运行概况与安全策略",
    access: "管理 IP / UA / 用户的黑白名单规则",
    audit: "查看登录、操作、拉取等安全审计记录",
    debug: "Postman 式单次请求，用于诊断代理链路与上游接口",
    backup: "导出与导入系统配置备份",
  };

  return (
    <div className="flex gap-0 h-full -mx-4 sm:-mx-6 lg:-mx-8">
      {/* ======== Sidebar (desktop) — sticky, independent scroll ======== */}
      <aside className="hidden md:flex md:flex-col w-56 lg:w-64 shrink-0 overflow-y-auto border-r sticky top-0 h-[calc(100svh-3.5rem)] sidebar-scroll">
        <div className="pt-8 pb-8 px-3 lg:px-4">
          <div className="flex items-center gap-2.5 px-3 mb-4 pb-4 border-b">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">
              {user.username.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{user.username}</p>
              <p className="text-[11px] text-muted-foreground">{isAdmin ? "管理员" : "用户"}</p>
            </div>
          </div>
          <SidebarNav />
        </div>
      </aside>

      {/* ======== Mobile sidebar overlay ======== */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <aside className="fixed left-0 top-0 bottom-0 w-64 bg-card border-r shadow-2xl z-50">
            <div className="flex items-center justify-between px-4 h-14 border-b">
              <span className="text-sm font-semibold">设置</span>
              <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)}>
                <X size={18} />
              </Button>
            </div>
            <div className="px-3 py-4">
              <div className="flex items-center gap-2.5 px-3 mb-4 pb-4 border-b">
                <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">
                  {user.username.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{user.username}</p>
                  <p className="text-[11px] text-muted-foreground">{isAdmin ? "管理员" : "用户"}</p>
                </div>
              </div>
              <SidebarNav />
            </div>
          </aside>
        </div>
      )}

      {/* ======== Main content ======== */}
      <div className="flex-1 min-w-0 h-full overflow-y-auto content-scroll">
        <div className="px-4 sm:px-6 lg:px-8 pt-8 pb-8">
          {/* ---- header ---- */}
          <div className="flex items-center gap-3 mb-8">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden shrink-0"
              onClick={() => setSidebarOpen(true)}
              aria-label="打开导航菜单"
            >
              <Menu size={18} />
            </Button>
            <div>
              <h1 className="text-xl font-bold tracking-tight">{panelLabel}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">{panelDesc[activeSection]}</p>
            </div>
          </div>

          {/* ---- Panels ---- */}
          {activeSection === "account" && (
            <AccountPanel
              user={user}
              onUserUpdate={setUser}
              onNavigate={(path) => navigate(path)}
            />
          )}

          {activeSection === "providers" && <ProviderManagementPanel isAdmin={isAdmin} />}

          {activeSection === "users" && isAdmin && <UsersPanel currentUserId={user.id} />}

          {activeSection === "settings" && isAdmin && <SecurityPanel />}

          {activeSection === "access" && isAdmin && <AccessControlPanel />}

          {activeSection === "audit" && isAdmin && (
            <AuditLogPanel users={adminUsers.map((u) => ({ id: u.id, username: u.username }))} />
          )}

          {activeSection === "debug" && isAdmin && (
            <div className="space-y-4">
              <div className="flex gap-1 rounded-md border bg-input/20 p-1 w-fit">
                <button
                  type="button"
                  onClick={() => setDebugTab("postman")}
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                    debugTab === "postman"
                      ? "bg-card shadow text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Postman 调试
                </button>
                <button
                  type="button"
                  onClick={() => setDebugTab("capture")}
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                    debugTab === "capture"
                      ? "bg-card shadow text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  流量录制
                </button>
              </div>
              {debugTab === "postman" ? <DebugToolPanel /> : <CapturePanel />}
            </div>
          )}

          {activeSection === "backup" && isAdmin && <BackupPanel />}
        </div>
      </div>
    </div>
  );
}
