---
name: cloudmirror
description: "cloudMirror 项目开发助手（全栈）。Use when: 在本仓库中开发/调试——新增或扩展 Provider 源代理、实现 Cloudflare Worker 后端（D1/鉴权/限流/API）、开发 React + shadcn/ui 前端页面、运行或编写 Vitest 测试、执行部署与数据库迁移。涵盖: Provider SDK（_base.ts/manager/docs-manager）、平台 API 命名空间 /cloudmirror-api/v1、三态路由、SSRF 校验、fetch 白名单派生、D1 schema、wrangler 配置。"
argument-hint: "[新增Provider | 扩展Provider | Worker后端 | 前端页面 | 测试 | 部署 | D1]"
user-invocable: true
---

# cloudMirror 项目开发助手

> 本 skill 是 cloudMirror 仓库的唯一开发指南，覆盖全栈开发场景。架构权威基准见 `docs/architecture.md`，代码规范见 `docs/development.md`。

## 何时使用

- 新增一个**全新的**源代理 Provider
- 扩展**已有** Provider（凭据类型/搜索映射/文档/图标）
- 开发 Worker 后端（API 端点 / D1 / 鉴权 / 限流 / CRON）
- 开发 React + shadcn/ui 前端页面
- 编写/运行测试，执行部署或数据库迁移

## 项目速览

```
src/providers/        # Provider SDK（核心）：_base.ts 基类 + 14 个 provider + manager/docs-manager
src/worker/           # Cloudflare Worker：入口/路由/D1/鉴权/限流/API 端点（/cloudmirror-api/v1）
src/components/       # 前端组件（shadcn/ui 源码在 ui/）
src/pages/            # 前端页面
src/shared/           # 前后端共享：types.ts / api.ts（PLATFORM_API_PREFIX）/ 工具
docs/                 # architecture.md（架构权威）+ development.md（规范）
schema.sql            # D1 表结构
example.wrangler.toml # 部署配置模板
```

**关键架构约束**（详见 docs/architecture.md）：

1. **三态路由，子域优先**：`worker/index.ts` 判定顺序为 子域代理 → `/cloudmirror-api/*` 平台 API → SPA。子域上的上游路径（如 cargo `/api/v1/`）不得被平台 API 分支拦截。
2. **平台 API 前缀**：一律用 `platformApi()`（`src/shared/api.ts`）派生，禁止硬编码 `/api/v1`。
3. **base = 纯执行管线，provider = 纯声明单元**：禁止向 `_base.ts` 添加跨源知识。
4. **SSRF**：所有端点必须 `https://` 且 host 非内网/IP（`validateContract()` 强制）。
5. **详情服务端一站式**：前端 `StaticTabRenderer` 纯渲染，禁止浏览器直连上游。

## 新增一个 Provider（标准流程）

### 1. 创建 Provider 类

新建 `src/providers/<name>.provider.ts`，继承 `ProviderDefinition`：

```ts
import { ProviderDefinition } from "./_base";
import type { ProviderMeta, ProxyConfig, SearchConfig,
  ResultMapping, ResultCardConfig, DetailConfig, SetupGuideConfig } from "../shared/types";

export class FooProvider extends ProviderDefinition {
  readonly id = "foo";
  readonly upstream = "https://foo.example";
  readonly authMode = "none" as const;          // "none" | "bearer" | "basic"

  readonly meta: ProviderMeta = {
    id: "foo", name: "Foo Central", label: "Foo",
    icon: { kind: "simple-icons", name: "siFoo" },  // 优先级: simple-icons > lucide > svg > image
    description: "Foo 源镜像加速",
    searchEnabled: true, searchLabel: "搜索 Foo...",
    searchHint: "foo install <pkg>",
    setupComponent: "", setupFields: [],
    enabled: true,
  };   // 注意：不含 searchApi/route（由 site-info 自动派生）
}
```

### 2. 声明代理（多数源无需覆写 handleProxy）

```ts
// 简单透传：无需 proxy 字段（默认 this.upstream）
// 多上游 + 自定义头：声明路由表 + hooks
readonly proxy: ProxyConfig = {
  routes: [
    { prefix: "/api/", upstream: "https://api.foo.example" },
    { prefix: "/raw/", upstream: "https://raw.foo.example" },
  ],
  exposeHeaders: true,
  hooks: {
    onBuildRequest: (ctx) => {
      ctx.headers.set("Accept", "application/vnd.foo+json");
    },
  },
};
```

hooks 阶段：`onResolve`（改 target）→ `onBuildRequest`（改 headers）→ `onSend`（改响应）→ `onError`。hook 抛错自动降级 502。

### 3. 声明搜索

```ts
// 单端点搜索源
readonly search: SearchConfig = {
  endpoint: "https://api.foo.example/search",
  queryParam: "q",                // 默认 "q"
  pagination: "offset",           // "page" | "offset" | "none"（token 不可回溯用 none）
  pageSizeParam: "size",
  offsetParam: "from",
};
// 多端点/特殊逻辑 → 覆写 doSearch(query, page, pageSize, pat?)
```

### 4. 实现渲染契约（4 个 getter）

- `defineResultMapping()` — 原始 API JSONPath → `GenericSearchItem`（itemsPath/totalPath/fields）
- `defineResultCard()` — 卡片配置（badges/stats/quickCommands/detailLink）
- `defineDetail()` — 详情配置（infoEndpoint/infoMapping/tabs/quickConnects/hooks）
- `defineSetupGuide()` — 安装配置指南（summary/quickCommand/sections）

可选：`definePopularSearches()` / `defineCredentialTypes()` / `docs()` / `resolveDetailTarget()`。

### 5. 注册

`src/providers/registry.ts`：

```ts
import { fooProvider } from "./foo.provider";
// ...
manager.register(fooProvider);
```

### 6. 验证

```bash
yarn typecheck
yarn vitest run src/providers   # baseline（契约校验）+ pipeline（管线行为）全过
```

注册后自动联动：首页搜索标签、上游管理、`/docs/:id`、`/fetch` 白名单（`collectProxyUpstreams()` 自动收录）。

## Worker 后端开发

### API 端点

平台 API 端点位于 `src/worker/api/*.ts`，在 `worker/api/index.ts` 注册：

```ts
case path.startsWith("/foo"):
  return handleFooRoute(request, env);
```

- 路径从前缀 `PLATFORM_API_PREFIX` 剥离后匹配
- 返回统一用 `makeRes(JSON.stringify({ success, ... }), status, headers)`
- 鉴权：Web 用户用 `authenticateWeb`；CLI 子域用 `resolveRoute`（PAT 解密在 router.ts）

### D1 操作

- 表结构在 `schema.sql`（users / user_providers / provider_settings / credentials / settings / audit_logs / ...）
- 查询函数集中在 `src/worker/db.ts`
- 本地：`yarn db:init:local`；远端：`yarn db:init:remote`

### 常见约束

- 代理请求门控（写操作开关/限流/UA/IP 黑白名单）在 `worker/index.ts` handleProxyRequest
- PAT 加密解密：`src/worker/crypto.ts`（AES-256-GCM）
- CRON：`src/worker/cron.ts`（health-check / aggregate-usage / daily-maintenance，上限 3 个）

## 前端开发

- shadcn/ui v4（@base-ui/react 后端）+ Tailwind CSS v4；新组件用 `npx shadcn@latest add <name>` 生成到 `src/components/ui/`
- 页面在 `src/pages/`，组件在 `src/components/`，API 封装在 `src/lib/api.ts`
- Provider 数据获取：`useProvider(id)` / `useSearchProviders()` / `useAllProviders()`（`src/hooks/use-provider.ts`）
- 详情页：`GenericDetail` 调用 `apiDetail.get(type, target)` → `StaticTabRenderer` 渲染服务端数据
- Docs 页：`Docs.tsx` 消费 `renderDocs(provider, ctx)`（自动派生 + prose）
- 模板插值：`interpolateTemplate(tpl, ctx)`（`src/shared/utils/template.ts`），变量如 `{hash}`/`{domain}`/`{title}`

## 测试与质量

```bash
yarn typecheck          # TS strict
yarn lint               # oxlint（或直接 oxlint）
yarn test               # 全量 vitest
yarn vitest run src/providers   # SDK 专项：baseline + pipeline（33 项）
yarn build              # 前端生产构建
```

- 新增 Provider 需在 `provider-sdk.baseline.test.ts` 中满足元数据/契约校验，管线行为在 `provider-sdk.pipeline.test.ts`
- Worker API 测试在 `src/worker/__tests__/api/`，URL 用 `/cloudmirror-api/v1` 前缀
- 已知既有失败（与功能无关，勿"修复"）：crypto 空密码、auth register invite/open 模式

## 部署与数据库

```bash
yarn deploy          # 构建 + wrangler deploy --env production
yarn deploy:dry      # dry-run 预览
yarn db:reset:local  # 重建本地 D1
wrangler d1 export cloudmirror-db --remote --output backup.sql   # 备份
```

- 子域：`{hash}.mirror.example.com`，DNS 需 `*.mirror.example.com CNAME mirror.example.com`
- 密钥：`wrangler secret put JWT_SECRET` / `ENCRYPTION_KEY`（64 位 hex）
- 配置模板：`example.wrangler.toml` / `.dev.vars.example`
