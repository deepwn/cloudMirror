<div align="center">

# ☁️ cloudMirror

**开发源集成管理平台 — 基于 Cloudflare Workers 的多协议上游源镜像加速**

为 Docker / GitHub / Hugging Face / npm / PyPI / Cargo / Go / Maven / NuGet / RubyGems / Composer / CPAN / Dart / CRAN 提供统一搜索、详情页与边缘代理加速。每个用户对每个源拥有**独立子域 + 独立凭据**，通过声明式 **Provider SDK** 即可低成本接入新源。

</div>

---

## ✨ 核心能力

| 能力                   | 说明                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| 🔍 **多源统一搜索**    | 所有 Provider 通过 `doSearch()` 驱动，结果卡片 / 详情页统一模板渲染                                     |
| 🔐 **Provider 级凭据** | 每用户每 Provider 独立 `{hash}` 子域 + 独立 PAT（AES-256-GCM 加密），匿名拉取公开资源、凭据突破速率限制 |
| 👤 **用户体系**        | JWT 登录 / 邀请注册 / 管理员面板 / Provider 开关 / 凭据轮换                                             |
| 🔌 **Provider SDK v2** | 声明式 `proxy` / `search` 配置 + 分阶段 hooks，新增源仅需 1 个文件 + 1 行注册                           |
| 📄 **自动文档**        | DocsManager 从 Provider 声明自动派生端点表 / 搜索 API / 凭据 / 快速连接                                 |
| 🛡️ **安全基线**        | SSRF 白名单派生校验、hook 异常降级、审计日志、限流、UA/IP 黑名单                                        |
| 🔧 **调试工具**        | Postman 式 debug-fetch（Worker 侧 HTTP 诊断）+ 流量录制（透明代理抓取 CLI 请求链路，用于构造未知 Provider） |

## 📦 内置源（14 个）

| 生态       | Provider  | 说明                             |
| ---------- | --------- | -------------------------------- |
| 🐳 容器    | docker    | Docker Hub Token 交换 + OCI 分发 |
| 🔀 代码    | github    | git clone / Raw / Release / LFS  |
| 🧠 AI      | hf        | Hugging Face 模型 + 数据集双索引 |
| 📦 Node.js | npm       | registry 搜索 / 安装代理         |
| 🐍 Python  | pypi      | pip / uv / Poetry                |
| 🦀 Rust    | cargo     | crates.io + sparse index         |
| 🐹 Go      | gomod     | GOPROXY                          |
| ☕ JVM     | maven     | Maven Central                    |
| 🔷 .NET    | nuget     | NuGet Gallery                    |
| ♦️ Ruby    | rubygems  | RubyGems                         |
| 🐘 PHP     | packagist | Composer                         |
| 🐪 Perl    | cpan      | MetaCPAN                         |
| 🎯 Dart    | dart      | pub.dev                          |
| 📊 R       | cran      | CRAN                             |

## 🏗️ 技术栈

| 层     | 技术                             |
| ------ | -------------------------------- |
| 运行时 | Cloudflare Workers (TypeScript)  |
| 数据库 | Cloudflare D1 (SQLite)           |
| 前端   | React 19 + React Router 7 + Vite |
| UI     | shadcn/ui + Tailwind CSS v4      |
| 测试   | Vitest + oxlint                  |
| 包管理 | Yarn 1.x                         |
| 部署   | Wrangler 4.x                     |

## 📁 仓库结构

```
src/
├── providers/        # Provider SDK：_base.ts 基类 + 14 个 provider + manager/docs-manager
├── worker/           # Cloudflare Worker：入口/路由/D1/鉴权/限流/API 端点
├── components/       # 前端组件（含 shadcn/ui）
├── pages/            # 前端页面（Home/Search/Detail/Docs/Settings/...）
├── hooks/            # 前端 hooks
├── lib/              # API 请求封装
└── shared/           # 前后端共享：类型/API 常量/工具
docs/                 # 架构设计 + 开发规范
schema.sql            # D1 数据库表结构
example.wrangler.toml # Wrangler 配置模板
```

## 🚀 快速开始

### 前置条件

- [Node.js](https://nodejs.org) ≥ 20 + [Yarn 1.x](https://classic.yarnpkg.com)
- [Cloudflare 账户](https://dash.cloudflare.com)（用于 Workers + D1）

### 1. 克隆与安装

```bash
git clone <your-repo-url> cloudmirror
cd cloudmirror
yarn install
```

### 2. 配置

```bash
cp example.wrangler.toml wrangler.toml   # 按注释替换 name / routes / database_id
cp .dev.vars.example .dev.vars           # 本地开发密钥（64 位 hex）
```

密钥生成（可选）：

```bash
openssl rand -hex 32   # 生成 64 位 hex，分别填入 .dev.vars 的 JWT_SECRET 与 ENCRYPTION_KEY
```

> ⚠️ 生产环境请勿将密钥写入文件——使用 `wrangler secret put JWT_SECRET` / `wrangler secret put ENCRYPTION_KEY` 注入。

### 3. 创建并初始化 D1 数据库

```bash
npx wrangler d1 create cloudmirror-db   # 记下输出的 database_id，填入 wrangler.toml
yarn db:init:remote                     # 远端执行 schema.sql
yarn db:init:local                      # 本地开发执行（首次）
```

### 4. 本地开发

```bash
yarn dev   # 打开 http://localhost:5173
```

首次访问站点会自动进入**管理员初始化流程**（创建管理员账户）。

### 5. 部署

```bash
yarn deploy   # 构建前端 + wrangler deploy
```

### 6. 配置子域（可选）

CLI 代理使用 `{hash}.{APP_DOMAIN}` 子域（如 `mirror.example.com`）。在 `wrangler.toml` 设置平台域名：

```toml
[vars]
APP_DOMAIN = "mirror.example.com"   # 子域代理后缀
```

DNS 添加通配解析：

```dns
*.mirror.example.com  CNAME  mirror.example.com
```

并在 `wrangler.toml` 配置通配 Route（免费通配证书）：

```toml
[[routes]]
pattern = "*.mirror.example.com/*"
zone_name = "example.com"
```

## 🧩 Provider SDK（新增一个源）

每个源是一个 TypeScript 类，继承 `ProviderDefinition`（`src/providers/_base.ts`），声明式描述代理/搜索/渲染契约：

```ts
// src/providers/<name>.provider.ts
import { ProviderDefinition } from "./_base";

export class FooProvider extends ProviderDefinition {
  readonly id = "foo";
  readonly upstream = "https://foo.example";
  readonly authMode = "none" as const;
  readonly meta = {/* id/name/icon/description/searchEnabled/... */};

  // 代理：声明路由表 + hooks（多数源无需覆写 handleProxy）
  readonly proxy = {
    routes: [{ prefix: "/api/", upstream: "https://api.foo.example" }],
    exposeHeaders: true,
  };

  // 搜索：声明端点 + 分页模式（或覆写 doSearch）
  readonly search = {
    endpoint: "https://api.foo.example/search",
    pagination: "offset",
    pageSizeParam: "size",
    offsetParam: "from",
  };

  defineResultMapping() {
    /* 原始 API → 通用搜索项 */
  }
  defineResultCard() {
    /* 卡片渲染配置 */
  }
  defineDetail() {
    /* 详情页 info + tabs */
  }
  defineSetupGuide() {
    /* 安装配置指南 */
  }
}
```

注册（`src/providers/registry.ts`）：

```ts
manager.register(fooProvider);
```

注册后自动联动：搜索标签、上游管理、Docs 页、`/fetch` 白名单。完整规范见 [docs/architecture.md](docs/architecture.md) 与 [docs/development.md](docs/development.md)。

## 🧪 开发验证

```bash
yarn typecheck            # TypeScript 类型检查
yarn test                 # Vitest 全量测试（138 项）
yarn vitest run src/providers   # Provider SDK 专项（58 项）
yarn build                # 前端生产构建
```

## ⌨️ 常用命令

| 命令                                      | 说明                       |
| ----------------------------------------- | -------------------------- |
| `yarn dev`                                | 本地开发（Vite + workerd） |
| `yarn db:init:local` / `db:init:remote`   | 初始化 D1 数据库           |
| `yarn db:reset:local` / `db:reset:remote` | 重建 D1 数据库             |
| `yarn build`                              | 前端生产构建               |
| `yarn deploy`                             | 构建 + 部署                |
| `yarn typecheck`                          | 类型检查                   |
| `yarn test`                               | 全量测试                   |

## 📚 文档

- [架构设计](docs/architecture.md) — 执行流程路径、核心组件、开发基准
- [开发规范](docs/development.md) — 代码规范、测试要求、贡献流程
- [文档索引](docs/README.md)

## 📄 License

[MIT](LICENSE)
