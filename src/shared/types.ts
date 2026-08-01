// ============================================================================
// src/shared/types.ts — 前后端共享类型定义
// ============================================================================

// ===== 用户 & 权限 =====

export type UserRole = "user" | "admin";
export type UserStatus = "active" | "suspended" | "deleted";
export type ProviderType = "docker" | "ghcr" | "gcr" | "quay" | "k8s" | "nvcr" | "github" | "hf";
export type AuditEvent =
  | "login_failed"
  | "login_success"
  | "hash_invalid"
  | "hash_rotated"
  | "credential_added"
  | "credential_deleted"
  | "user_created"
  | "user_suspended"
  | "user_deleted"
  | "user_restored"
  | "settings_changed"
  | "password_reset"
  | "invite_created"
  | "proxy_pull"
  | "brute_blocked";

export interface User {
  id: string;
  username: string;
  password: string; // PBKDF2-SHA256 hash
  role: UserRole;
  status: UserStatus;
  email: string | null;
  note: string | null;
  token_version: number;
  deleted_at: string | null; // 软删除时间
  created_at: string;
  updated_at: string;
}

export interface UserPublic {
  id: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
}

// ===== 凭据 =====

export interface Credential {
  id: string;
  user_id: string;
  provider: ProviderType;
  label: string;
  username: string;
  secret: string; // AES-256-GCM 加密 (Base64)
  is_active: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CredentialPublic {
  id: string;
  provider: ProviderType;
  label: string;
  username: string;
  is_active: boolean;
  last_used_at: string | null;
}

// ===== v1.0: 用户级 Provider 配置 =====

export interface UserProvider {
  id: string;
  user_id: string;
  provider: string;
  hash: string;
  enabled: number;
  pat: string | null;
  pat_username: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderSetting {
  provider: string;
  enabled: number;
  fallback_pat: string | null;
  rate_limit: number | null;
  created_at: string;
  updated_at: string;
}

// ===== 用量 & 配额 =====

export interface UserLimits {
  id: string;
  user_id: string;
  provider: string; // '*' = 全局
  rate_limit: number;
  bandwidth_limit: number | null; // GB
  concurrency: number;
  expires_at: string | null;
}

export interface UsageLog {
  id: string;
  user_id: string;
  provider: string;
  path: string;
  method: string;
  status: number;
  bytes_in: number;
  bytes_out: number;
  duration_ms: number;
  client_ip: string | null;
  created_at: string;
}

export interface DailyUsage {
  id: string; // '{user_id}:{date}'
  user_id: string;
  date: string;
  provider: string;
  requests: number;
  bytes_in: number;
  bytes_out: number;
  cache_hits: number;
}

// ===== 审计日志 =====

export interface AuditLog {
  id: string;
  actor_id: string | null;
  actor_ip: string | null;
  actor_ua: string | null;
  event: AuditEvent;
  target_type: string | null;
  target_id: string | null;
  detail: string | null; // JSON
  created_at: string;
}

// ===== JWT =====

export interface JwtPayload {
  sub: string; // user_id
  role: UserRole;
  ver: number; // token_version，用于会话吊销
  iat: number;
  exp: number;
}

export interface SessionInfo {
  id: string;
  client_ip: string | null;
  client_ua: string | null;
  is_current: number;
  created_at: string;
}

// ===== 路由上下文 =====

export interface RouterContext {
  hash: string;
  type: string;
  providerDir: string;
  upstream: string;
}

export interface AuthContext {
  user: User;
  credential?: Credential; // CLI 鉴权时有值
}

// ===== Provider 元数据 =====

export interface SetupField {
  label: string;
  value: string;
  code?: boolean;
}

export type ProviderIconSpec =
  | {
      kind: "lucide";
      name: string;
    }
  | {
      kind: "simple-icons";
      name: string;
      colored?: boolean;
      /** 强制单色模式（使用 currentColor），覆盖 colored */
      monochrome?: boolean;
    }
  | {
      kind: "image";
      src: string;
      alt?: string;
    }
  | {
      kind: "svg";
      viewBox: string;
      paths: string[];
    };

export interface ProviderMeta {
  id: string;
  name: string;
  label?: string;
  icon?: ProviderIconSpec;
  description: string;
  searchEnabled: boolean;
  searchLabel: string;
  searchHint: string; // 搜索示例命令
  setupComponent: string;
  setupFields: SetupField[];
  enabled: boolean;
}

export interface ProviderGuideItem {
  label: string;
  value: string;
  mode: "inline" | "block";
}

export interface ProviderGuideSection {
  title: string;
  description?: string;
  items: ProviderGuideItem[];
}

export interface ProviderGuide {
  summary: string;
  highlight: string;
  quickCommand: string;
  sections: ProviderGuideSection[];
  popularSearches?: { name: string; description: string }[];
}

// ===== API 响应 =====

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  page: number;
  pageSize: number;
  total: number;
}

// ===== v1.0: Provider SDK 通用类型 =====

/** 通用搜索项 — 逐步替代 DockerSearchItem / GitHubSearchItem / HuggingFaceSearchItem */
export interface GenericSearchItem {
  id: string;
  providerType: string;
  kind: string;
  title: string;
  description: string;
  subtitle?: string;
  subtitlePrefix?: string;
  author?: string;
  url?: string;
  stats: Record<string, GenericStatValue>;
  raw: Record<string, unknown>;
}

export interface GenericStatValue {
  value: unknown;
  label: string;
  format: "number" | "bytes" | "duration" | "date" | "text";
}

export interface GenericSearchResponse {
  results: GenericSearchItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** 搜索结果 JSONPath 映射配置 */
export interface ResultMapping {
  itemsPath: string;
  totalPath: string;
  itemKind?: string;
  itemIdField?: string;
  fields: {
    title: string;
    description: string;
    subtitle?: string;
    subtitlePrefix?: string;
    author?: string;
    url?: string;
    id?: string;
    stats?: { key: string; path: string; label: string; format: string }[];
  };
}

/** 搜索结果卡片配置 */
export interface ResultCardConfig {
  titleTemplate: string;
  badges?: {
    text: string;
    variant: string;
    condition?: { field: string; operator: string; value?: unknown };
  }[];
  descriptionShow: boolean;
  stats?: { field: string; label: string }[];
  quickCommands: { label: string; template: string }[];
  detailLink: string;
}

/** 详情页 Tab 配置 */
export interface TabConfig {
  id: string;
  label: string;
  icon?: ProviderIconSpec;
  type: "markdown" | "table" | "keyValue" | "code";
  language?: string;
  dataSource: {
    endpoint: string;
    responseType?: "json" | "text";
    responsePath?: string;
    /** 显式响应解码方式（如 GitHub readme 的 base64）。缺省不解码。 */
    decode?: "base64";
    /**
     * 文档基础 URL 模板（支持 {target}），type=markdown 时用于派生 DetailTabData.baseUrl，
     * 前端据此将相对资源解析为原始绝对 URL 直接加载（不做代理）。
     * 如 github README 相对图片基于 "https://raw.githubusercontent.com/{target}/HEAD/"。
     */
    docBase?: string;
    columns?: {
      field: string;
      label: string;
      format?: string;
      emptyText?: string;
    }[];
  };
}

/**
 * 详情页模板变量取值器（由各 Provider 自行声明）。
 * 用于 quickConnects 模板插值（{version}/{v}/{g}/{a}）与「打开源页面」URL 渲染。
 * string 为单路径；string[] 按序取第一个命中。
 */
export interface MetaFieldsConfig {
  version?: string | string[];
  g?: string | string[];
  a?: string | string[];
}

/** 详情页配置 */
export interface DetailConfig {
  infoEndpoint: string;
  infoMapping: {
    title: string;
    description: string;
    author?: string;
    stats?: { label: string; path: string; type?: string }[];
  };
  /** 模板变量取值器（缺省时 a 回退为 target） */
  metaFields?: MetaFieldsConfig;
  /** 详情页「打开源页面」URL 模板。支持 {target}/{g}/{a}/{v}/{version} 占位符。 */
  detailUrlTemplate?: string;
  quickConnects?: { label: string; template: string }[];
  tabs: TabConfig[];
  /** SDK v2: 详情管线阶段 hooks */
  hooks?: DetailHooks;
}

/** 单个 Tab 的已解析数据（服务端 fetch 后返回给前端直接渲染） */
export interface DetailTabData {
  /** Tab ID */
  id: string;
  /** Tab 显示标签 */
  label: string;
  /** Tab 图标 */
  icon?: ProviderIconSpec;
  /** 内容类型 */
  type: "markdown" | "table" | "keyValue" | "code";
  /** 代码语言（type=code 时） */
  language?: string;
  /** 已解析的数据 */
  data: unknown;
  /** 表格列配置（type=table 时） */
  columns?: { field: string; label: string; format?: string; emptyText?: string }[];
  /**
   * 文档基础 URL（type=markdown 时，由 dataSource.docBase 模板渲染 {target} 得到）。
   * 前端据此将 markdown 中的相对资源解析为原始绝对 URL 直接加载（不做代理）。
   */
  baseUrl?: string;
}

/** 统一详情 API 响应 */
export interface DetailData {
  /** 包/仓库标题 */
  title: string;
  /** 描述 */
  description?: string;
  /** 作者/命名空间 */
  author?: string;
  /** 统计信息 */
  stats?: { label: string; value: string }[];
  /** 快速连接命令 */
  quickConnects?: { label: string; template: string }[];
  /** 各 Tab 数据（已由 Provider 服务端 fetch 并解析完毕） */
  tabs: DetailTabData[];
  /** 模板插值变量（version/v/g/a 等常用提取值） */
  meta?: Record<string, string>;
}

/** 用户配置指南 */
export interface SetupGuideConfig {
  summary: string;
  quickCommand: string;
  sections: {
    title: string;
    items: { label: string; value: string; mode: "inline" | "block" }[];
  }[];
}

/** 热门搜索提示 */
export interface PopularSearch {
  name: string;
  description: string;
}

/** 代理路由解析结果 */
export interface ResolvedRoute {
  userId: string;
  providerType: string;
  pat: string | null;
  patUsername: string | null;
}

// ===== SDK v2: 声明式配置契约 =====
// 设计依据: docs/architecture.md §3 ~ §4

/** 代理路径前缀 → 上游主机映射 */
export interface ProxyRoute {
  prefix: string;
  upstream: string;
  exposeHeaders?: boolean;
  /**
   * true 时剥离 prefix 再拼接到上游（上游路径布局与镜像不同，如 raw.githubusercontent.com / index.crates.io）。
   * 缺省 false：完整路径拼接（镜像路径 == 上游路径）。
   */
  stripPrefix?: boolean;
}

/** 代理管线上下文（hook 只改 ctx，不直接改方法签名） */
export interface ProxyContext {
  request: Request;
  route: ResolvedRoute;
  /** 最终上游完整 URL（onResolve 决定，可被后续 hook 改写） */
  target: string;
  headers: Headers;
  body?: BodyInit | null;
  /** fetch 后的原始响应 */
  upstream?: Response;
  /** onSend 决定的最终响应 */
  response?: Response;
}

/** 代理管线 hooks（Fastify lifecycle 窄化版） */
export interface ProxyHooks {
  onResolve?: (ctx: ProxyContext) => void | Promise<void>;
  onBuildRequest?: (ctx: ProxyContext) => void | Promise<void>;
  onSend?: (ctx: ProxyContext) => void | Promise<void>;
  onError?: (ctx: ProxyContext, err: unknown) => Response | void;
}

/** 代理声明式配置 */
export interface ProxyConfig {
  /** 路径前缀 → 上游（最长前缀优先） */
  routes?: ProxyRoute[];
  /** 默认上游（缺省回退 this.upstream） */
  defaultUpstream?: string;
  /** 是否暴露全部 CORS 响应头（Access-Control-Expose-Headers: *） */
  exposeHeaders?: boolean;
  hooks?: ProxyHooks;
}

/** 分页模式：page / offset / token(不可回溯) / none */
export type SearchPagination = "page" | "offset" | "token" | "none";

/** 搜索管线上下文 */
export interface SearchContext {
  query: string;
  page: number;
  pageSize: number;
  pat?: string;
  /** onBuildRequest 可改写 */
  url: URL;
  headers: Record<string, string>;
  /** onParse 产出的原始数据 */
  data?: unknown;
  /** onMap 前（默认走 defineResultMapping） */
  items: unknown[];
  total: number;
  /** 最终标准化结果（默认由 base 填充） */
  response?: GenericSearchResponse | null;
}

/** 搜索管线 hooks */
export interface SearchHooks {
  onBuildRequest?: (ctx: SearchContext) => void | Promise<void>;
  onParse?: (ctx: SearchContext) => void | Promise<void>;
  onMap?: (ctx: SearchContext) => void | Promise<void>;
}

/** 搜索声明式配置 */
export interface SearchConfig {
  endpoint: string;
  /** 查询参数名（默认 "q"） */
  queryParam?: string;
  /** 页大小参数名（默认 "per_page"） */
  pageSizeParam?: string;
  /** 页码参数名（page 模式） */
  pageParam?: string;
  /** 偏移参数名（offset 模式，offset = (page-1)*pageSize） */
  offsetParam?: string;
  /** 分页模式（默认 "page"） */
  pagination?: SearchPagination;
  extraParams?: Record<string, string>;
  hooks?: SearchHooks;
}

/** 详情管线上下文 */
export interface DetailContext {
  target: string;
  rawInfo: Record<string, unknown> | null;
  detail: DetailData;
}

/** 详情管线 hooks */
export interface DetailHooks {
  onInfoFetched?: (ctx: DetailContext) => void | Promise<void>;
  onTabResolved?: (ctx: DetailContext, tab: DetailTabData) => void | Promise<void>;
}

/** 统一渲染契约：聚合 defineXxx() getter，可整体校验（SDK v2 §5.4） */
export interface RenderContract {
  resultMapping: ResultMapping;
  resultCard: ResultCardConfig;
  detail: DetailConfig;
  setupGuide: SetupGuideConfig;
  popularSearches: PopularSearch[];
  credentialTypes: { value: string; label: string; authMode: "basic" | "bearer" }[];
}

/** Docs 散文章节（markdown 内容） */
export interface DocsSection {
  title: string;
  markdown: string;
}

/** Provider 文档声明（SDK v2 §5.5） */
export interface ProviderDocs {
  summary: string;
  quickStart: { command: string; note?: string };
  /** 作者手写散文章节 */
  sections: DocsSection[];
  /** 自动派生开关：从声明式配置生成（端点表 / 搜索 API / 凭据 / 快速连接） */
  auto?: {
    proxyEndpoints?: boolean;
    searchApi?: boolean;
    credentials?: boolean;
    quickConnects?: boolean;
  };
}

/** DocsManager 渲染结果：自动派生章节 + prose 章节 */
export interface RenderedDocs {
  providerId: string;
  displayName: string;
  summary: string;
  quickStart: { command: string; note?: string };
  autoSections: DocsSection[];
  proseSections: DocsSection[];
}
