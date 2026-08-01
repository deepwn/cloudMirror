// ============================================================================
// src/frontend/src/lib/api.ts — API 请求封装 + JWT
// ============================================================================

import type { GenericSearchItem } from "@shared/types";
import type { ProviderIconSpec } from "@shared/types";
import type { DetailData } from "@shared/types";
import { PLATFORM_API_PREFIX } from "../shared/api";

const BASE = PLATFORM_API_PREFIX;

function getToken(): string | null {
  return localStorage.getItem("cloudmirror_token");
}

export function setToken(token: string): void {
  localStorage.setItem("cloudmirror_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("cloudmirror_token");
  localStorage.removeItem("cloudmirror_user");
}

export function getStoredUser(): {
  id: string;
  username: string;
  hash: string;
  role: string;
} | null {
  const raw = localStorage.getItem("cloudmirror_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 登录成功通知 Header 更新状态 */
export function dispatchAuthEvent() {
  window.dispatchEvent(new CustomEvent("authchange"));
}

export async function fetchProxy(
  fetchUrl: string,
  type: "json" | "text" = "json",
): Promise<{ ok: boolean; status: number; body: string; isJson: boolean }> {
  return request<{ ok: boolean; status: number; body: string; isJson: boolean }>("/fetch", {
    method: "POST",
    body: JSON.stringify({ url: fetchUrl, type }),
  });
}

export async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // 401 → 自动登出，清除 token
    if (res.status === 401 && getToken()) {
      clearToken();
      dispatchAuthEvent();
    }
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return data as T;
}

// Auth
export const auth = {
  login: (username: string, password: string) =>
    request<{ token: string; user: { id: string; username: string; hash: string; role: string } }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ username, password }) },
    ),
  register: (username: string, password: string) =>
    request<{ token: string; user: { id: string; username: string; hash: string; role: string } }>(
      "/auth/register",
      { method: "POST", body: JSON.stringify({ username, password }) },
    ),
  registerWithInvite: (username: string, password: string, inviteCode: string, email?: string) =>
    request<{ token: string; user: { id: string; username: string; hash: string; role: string } }>(
      "/auth/register",
      {
        method: "POST",
        body: JSON.stringify({ username, password, invite_code: inviteCode, email }),
      },
    ),
  me: () =>
    request<{
      id: string;
      username: string;
      hash: string;
      role: string;
      status?: string;
      email?: string | null;
    }>("/auth/me"),
  changePassword: (newPassword: string) =>
    request<{ success: boolean }>("/auth/password", {
      method: "PUT",
      body: JSON.stringify({ newPassword }),
    }),
  updateProfile: (data: { username?: string; email?: string }) =>
    request<{ success: boolean; username?: string; email?: string | null }>("/auth/profile", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deactivate: () => request<{ success: boolean }>("/auth/deactivate", { method: "POST" }),
  rotateHash: () => request<{ hash: string }>("/auth/rotate-hash", { method: "POST" }),
  setupStatus: () => request<{ needsSetup: boolean }>("/auth/setup-status"),
  setup: (data: { username: string; password: string; email?: string }) =>
    request<{ token: string; user: { id: string; username: string; hash: string; role: string } }>(
      "/auth/setup",
      { method: "POST", body: JSON.stringify(data) },
    ),
  sessions: () =>
    request<{
      success: boolean;
      data: Array<{
        id: string;
        client_ip: string | null;
        client_ua: string | null;
        is_current: number;
        created_at: string;
      }>;
    }>("/auth/sessions"),
  revokeAll: () =>
    request<{ success: boolean; token: string }>("/auth/sessions/revoke", { method: "POST" }),
};

// Search (v1.0: 统一搜索)
export const apiSearch = {
  search: (q: string, type: string, page = 1, pageSize = 25) =>
    request<{
      success?: boolean;
      results: GenericSearchItem[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/search?q=${encodeURIComponent(q)}&type=${type}&page=${page}&pageSize=${pageSize}`),
};

// Detail (v1.0: 统一详情 API — 服务端一站式获取 info + tabs)
export const apiDetail = {
  get: (type: string, target: string) =>
    request<{ success: boolean } & DetailData>(
      `/detail?type=${encodeURIComponent(type)}&target=${encodeURIComponent(target)}`,
    ),
};

// Credentials
export const credentials = {
  list: (provider?: string) =>
    request<{ success: boolean; data: CredentialPublic[] }>(
      `/credentials${provider ? `?provider=${provider}` : ""}`,
    ),
  create: (data: { provider: string; label: string; username?: string; secret: string }) =>
    request<{ success: boolean; data: CredentialPublic }>("/credentials", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: { label?: string; username?: string; secret?: string; is_active?: boolean },
  ) =>
    request<{ success: boolean }>(`/credentials/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<{ success: boolean }>(`/credentials/${id}`, { method: "DELETE" }),
};

interface CredentialPublic {
  id: string;
  provider: string;
  label: string;
  username: string;
  is_active: boolean;
  last_used_at: string | null;
}

// Dashboard
export const dashboard = {
  summary: () => request<{ success: boolean; data: DashboardSummary }>("/dashboard/summary"),
  usage: (days = 30) =>
    request<{ success: boolean; data: UsageEntry[] }>(`/dashboard/usage?days=${days}`),
};

interface DashboardSummary {
  user: {
    id: string;
    username: string;
    hash: string;
    role: string;
    status: string;
    created_at: string;
  };
  stats: {
    totalRequests: number;
    totalBytesOut: number;
    totalCacheHits: number;
    cacheHitRate: number;
    credentialCount: number;
  };
  providers: Record<string, boolean>;
  limits: {
    provider: string;
    rateLimit: number;
    bandwidthLimit: number | null;
    concurrency: number;
    expiresAt: string | null;
  }[];
}

interface UsageEntry {
  date: string;
  provider: string;
  requests: number;
  bytesIn: number;
  bytesOut: number;
  cacheHits: number;
}

// Site
// searchApi / route 由 worker 端 /site-info 从 platformApi() 统一派生，不再由 Provider 手写
// （见 docs/architecture.md §2.1）
export const site = {
  info: () =>
    request<{
      name: string;
      version: string;
      /** 平台域名（子域代理后缀），如 mirror.example.com */
      domain: string;
      providers: {
        id: string;
        name: string;
        icon?: ProviderIconSpec;
        description: string;
        searchEnabled: boolean;
        searchLabel: string;
        searchHint: string;
        searchApi: string;
        route: string;
        enabled: boolean;
      }[];
    }>("/site-info"),
  health: () => request<{ status: string }>("/health"),
};

// Admin
export const admin = {
  stats: () => request<{ success: boolean; data: AdminStats }>("/admin/stats"),
  users: (page = 1, pageSize = 20, search?: string) =>
    request<{
      success: boolean;
      data: { users: AdminUser[]; page: number; pageSize: number; total: number };
    }>(
      `/admin/users?page=${page}&pageSize=${pageSize}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
    ),
  updateUser: (id: string, data: { status?: string; role?: string; note?: string }) =>
    request<{ success: boolean }>(`/admin/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteUser: (id: string) =>
    request<{ success: boolean; message?: string }>(`/admin/users/${id}`, { method: "DELETE" }),
  restoreUser: (id: string) =>
    request<{ success: boolean; message?: string }>(`/admin/users/${id}/restore`, {
      method: "POST",
    }),
  invite: () =>
    request<{ success: boolean; data: { code: string; link: string; expires_at: string } }>(
      "/admin/invite",
      { method: "POST" },
    ),
  listInvites: () =>
    request<{
      success: boolean;
      data: {
        id: string;
        code: string;
        link: string;
        used_count: number;
        max_uses: number;
        expires_at: string;
        created_at: string;
      }[];
    }>("/admin/invite"),
  deleteInvite: (id: string) =>
    request<{ success: boolean }>(`/admin/invite/${id}`, { method: "DELETE" }),
  resetPassword: (userId: string) =>
    request<{ success: boolean; data: { username: string; password: string } }>(
      `/admin/users/${userId}/reset-password`,
      { method: "POST" },
    ),
  settings: () =>
    request<{
      success: boolean;
      data: { key: string; value: string; description: string | null }[];
    }>("/admin/settings"),
  updateSettings: (entries: { key: string; value: string }[]) =>
    request<{ success: boolean }>("/admin/settings", {
      method: "PUT",
      body: JSON.stringify(entries),
    }),
  auditLogs: (params?: {
    page?: number;
    pageSize?: number;
    event?: string;
    actorId?: string;
    username?: string;
    ip?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
    if (params?.event) qs.set("event", params.event);
    if (params?.actorId) qs.set("actorId", params.actorId);
    if (params?.username) qs.set("username", params.username);
    if (params?.ip) qs.set("ip", params.ip);
    const query = qs.toString();
    return request<{
      success: boolean;
      data: {
        rows: AuditLogEntry[];
        page: number;
        pageSize: number;
        total: number;
      };
    }>(`/admin/audit-logs${query ? `?${query}` : ""}`);
  },
  backup: {
    export: () =>
      request<{
        version: string;
        exportedAt: string;
        settings: { key: string; value: string }[];
        users: { username: string; hash: string; role: string; status: string }[];
      }>("/admin/backup"),
    import: (payload: unknown) =>
      request<{ success: boolean; message: string }>("/admin/backup", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  },
};

interface AdminStats {
  totalUsers: number;
  todayRequests: number;
  totalCredentials: number;
  activeProviders: number;
}

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

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  actorIp: string | null;
  actorUa: string | null;
  event: string;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown> | string | null;
  createdAt: string;
}
