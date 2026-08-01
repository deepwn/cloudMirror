# cloudMirror 开发规范

> 面向贡献者的基本开发规范。架构细节见 [architecture.md](./architecture.md)。

## 环境

| 工具 | 版本要求 |
| --- | --- |
| Node.js | ≥ 20 |
| Yarn | 1.x（`packageManager` 已锁定） |
| TypeScript | 5.x（`strict: true`） |

## 目录约定

| 目录 | 职责 | 约束 |
| --- | --- | --- |
| `src/providers/` | Provider SDK（基类 + 各源 + manager） | 每个源一个 `<name>.provider.ts`，禁止向 `_base.ts` 添加跨源知识 |
| `src/worker/` | Worker 后端（入口/路由/API/D1/鉴权） | 平台 API 统一前缀 `/cloudmirror-api/v1` |
| `src/components/` | 前端 UI 组件 | shadcn/ui 源码直接放 `ui/` |
| `src/pages/` | 前端页面 | 页面编排组件，不直接 fetch 上游 |
| `src/shared/` | 前后端共享 | 类型、API 常量（`PLATFORM_API_PREFIX`）、纯工具 |
| `docs/` | 架构与规范文档 | 变更同步更新 |

## 代码规范

### 通用

- TypeScript `strict`，`typecheck` 必须通过：`yarn typecheck`
- lint 必须通过（oxlint）：`yarn lint`（`oxlint`）
- 命名：camelCase 函数/变量、PascalCase 类/组件、kebab-case 文件
- 注释：中文注释说明"为什么"，避免无意义注释

### Provider 开发

- 继承 `ProviderDefinition`（`src/providers/_base.ts`），声明式优先：
  - `proxy` 配置（routes/hooks）替代覆写 `handleProxy`
  - `search` 配置（endpoint/pagination/hooks）替代覆写 `doSearch`
  - 仅特殊协议（token 交换、多端点合并）才覆写方法
- `meta.name` 标准全称，`meta.label` 紧凑短名，`meta.icon` 优先 simple-icons
- 端点协议必须 `https://`，host 不得为内网/IP（SSRF 校验强制）
- 注册：`src/providers/registry.ts` 中 `manager.register(xxxProvider)`

### Worker 后端

- 平台 API 路径一律通过 `platformApi()`（`src/shared/api.ts`）派生，禁止硬编码 `/api/v1`
- 子域请求（代理态）判定必须优先于平台 API 判定（三态路由）
- 所有 `fetch` 上游请求需考虑超时与降级（hook 异常 → 502/空结果）

### 前端

- 详情页数据由 Worker `getDetail()` 服务端一站式获取，组件用 `StaticTabRenderer` 纯渲染；**禁止**浏览器直连上游
- 请求封装统一走 `src/lib/api.ts`（BASE 已指向平台前缀）
- 卡片/详情/文档由 `defineResultCard()` / `defineDetail()` / `docs-manager` 驱动，禁止硬编码分支

## 测试要求

```bash
yarn test                      # 全量
yarn vitest run src/providers  # Provider SDK 专项（baseline + pipeline）
```

- 新增 Provider 必须通过 `provider-sdk.baseline.test.ts`（manager/render/docs 校验）与 `provider-sdk.pipeline.test.ts`（管线行为）
- Worker API 集成测试位于 `src/worker/__tests__/api/`，URL 使用 `/cloudmirror-api/v1` 前缀
- 提交前：`yarn typecheck` + `yarn test` + `yarn build` 全绿

## 贡献流程

1. Fork 仓库，从 `main` 切出特性分支 `feat/<name>`
2. 实现 + 补充测试（新增源需附带 baseline 用例）
3. 本地全量验证（typecheck / test / build）
4. 提交信息遵循 Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` / `chore:`）
5. 发起 Pull Request，说明改动与验证结果
