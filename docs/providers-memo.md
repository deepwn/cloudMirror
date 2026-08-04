# cloudMirror Provider 代理与鉴权审计备忘录

> 定位：**运维/排障参考** — 逐 Provider 记录代理管线、搜索接口、PAT 验证流程与已知缺陷。
> 权威架构见 [architecture.md](./architecture.md)，代码规范见 [development.md](./development.md)。
> 最后更新：2026-08-03（Docker 401 排查 + GitHub 参考实现比对 + 调试工具上线）

---

## 1. 总体架构速览

```
子域请求 ({hash}.{domain})
  → worker/index.ts handleProxyRequest
    → resolveRoute()            # hash → user_providers → PAT 解密 → Provider 实例
    → provider.handleProxy()    # _base.ts 默认管线
        onResolve → 默认头 + Bearer PAT 注入 → onBuildRequest → fetch → onSend → 输出
```

关键事实（排障必备）：

1. **Bearer PAT 注入在 base 层统一完成**（`_base.ts` `handleProxy`：`if (route.pat) ctx.headers.set("Authorization", "Bearer " + route.pat)`），Provider 的 `onBuildRequest` 可改写/删除。
2. **PAT 来源只有两张表**（`src/worker/router.ts` `resolveRoute`）：
   - 用户自设 `user_providers.pat`（前端"全局令牌"，管理员在 ProviderManagementPanel 配置）
   - 管理员全局 `provider_settings.fallback_pat`
3. ⚠️ **`credentials` 表（"访问凭据"）未接入 CLI 代理链路**：`src/worker/auth.ts` 的 `authenticateCli()` 从 `credentials` 表随机轮询选凭据，但**从未被 `worker/index.ts` 调用**（全仓库仅定义处）。用户在前端"访问凭据"处配置的 PAT **不会作用于 docker pull / git clone 等子域代理请求**。
4. 搜索链路（`/cloudmirror-api/v1/search`）的 PAT 由 `src/worker/api/search.ts` `resolveUserPat()` 从 **JWT + `user_providers.pat`** 解析并传入 `doSearch`，同样不读 `credentials` 表。

---

## 2. PAT 验证流程矩阵（区分各 Provider 的认证模式）

### 2.1 按 authMode 分类

| 类别 | Provider | authMode | PAT 注入方式 | 说明 |
|---|---|---|---|---|
| 容器 | docker | **basic** | base 注入被覆盖 → 服务端 **Token 交换** | Docker Hub 走 OCI Token 认证，不能直接 Bearer |
| 容器 | ghcr（docker provider 的 credentialTypes） | **bearer** | base 直接 `Bearer <pat>` | ghcr 接受 Bearer PAT 直通 |
| 容器 | gcr / quay / k8s / nvcr | **basic** | 仅存凭据类型定义 | **无对应代理逻辑**（docker provider 未实现这些 registry 的 token 交换/路由） |
| 代码 | github | **bearer** | base 直接 `Bearer <pat>` 透传 | github.com / api.github.com / raw.githubusercontent.com |
| AI | hf | **bearer** | base 直接 `Bearer <pat>` 透传；`doSearch` 也注入 | huggingface.co |
| 包管理 | cargo/cpan/cran/dart/gomod/maven/nuget/npm/packagist/pypi/rubygems | **none** | 不注入（可选 token 用于私有库） | 公开源为主 |

### 2.2 各容器 registry 的真实 token 端点（排障参考）

| Registry | Registry Host | Token/认证端点 | 认证头格式 |
|---|---|---|---|
| Docker Hub | `registry-1.docker.io` | `https://auth.docker.io/token?service=registry.docker.io&scope=repository:<repo>:pull` | Basic `username:PAT`（username 可用 `token`） |
| GHCR | `ghcr.io` | `https://ghcr.io/token?service=ghcr.io&scope=repository:<repo>:pull` | Basic `username:PAT` 或直接 Bearer PAT（ghcr 也接受 `ghcr.io` username） |
| GCR | `gcr.io` | `https://gcr.io/v2/token?service=gcr.io&scope=...` | Basic |
| Quay | `quay.io` | `https://quay.io/v2/auth?service=quay.io&scope=...` | Basic |
| K8s | `registry.k8s.io` | `https://registry.k8s.io/v2/token` 等 | Bearer/Basic 视组件 |
| NVCR | `nvcr.io` | `https://auth.nvcr.io/token?service=nvcr.io&scope=...` | Basic `$oauthtoken:PAT` |

⚠️ 现有 `src/worker/config.ts` 的 `REGISTRY_AUTH_MAP` 只声明了映射，`docker.provider.ts` 的 token 交换**只硬编码了 Docker Hub 的 `auth.docker.io`**，且 scope 写死 `pull`。**ghcr/gcr/quay/k8s/nvcr 并未接入任何代理路径或 token 交换逻辑** —— 它们只是 `defineCredentialTypes()` 里的声明，实际请求会直接打到对应 registry（未实现）。

### 2.3 Docker Hub 完整 token 流（对比参考实现）

标准 OCI 分发协议流程（`docker pull` / `skopeo` / `podman` 均遵循）：

```
客户端 → mirror: GET /v2/
mirror → registry-1.docker.io: GET /v2/                    （透传）
registry → mirror: 401 + WWW-Authenticate: Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
mirror → 客户端: 401 + WWW-Authenticate（⚠️ realm 是否被重写是成败关键）
客户端 → (realm): GET /token?service=...&scope=repository:<repo>:pull   ← 若 realm 未被重写则绕过 mirror！
客户端 → mirror: GET /v2/<repo>/manifests/<tag> + Authorization: Bearer <token>
```

**正确实现的三个参考要点**（来自社区成熟项目，见 §5）：

1. **服务端 token 交换**（cmliu 方案）：`/v2/`、`/manifests/`、`/blobs/`、`/tags/` 请求在 worker 内先向 `auth.docker.io/token` 换取 token 再带上游请求；PAT 存在时用 `Basic username:PAT` 交换。
2. **重写 `WWW-Authenticate` 响应头**（cmliu + ciiiii 都做）：把 401 挑战里的 `realm="https://auth.docker.io/token"` 重写为 mirror 自身地址（cmliu 直接替换为 `https://{mirror_host}`；ciiiii 重写为 `https://{mirror_host}/v2/auth` 并提供 `/v2/auth` 转发端点）。**否则客户端直接去 auth.docker.io 换 token，用户的 PAT 完全用不上，私有镜像必然 401**。
3. **`/v2/` 单段镜像名自动补 `library/`**：`/v2/busybox/manifests/latest` → `/v2/library/busybox/manifests/latest`（Docker Hub 约定）；scope 同理补 `repository:library/busybox:pull`。
4. **blob 307 Location 重写 / 手动 follow**：Docker Hub 会把 blob 下载 307 重定向到 `cloudflare` CDN 域名，Worker 需重写 `Location` 或手动 follow。

---

## 3. 各 Provider 代理 / 搜索接口逐项分析

> 汇总表见文末 §7。以下按"代理 + 搜索 + 鉴权"记录。**除 docker/github/hf 外，其余 Provider 的 `doSearch` 均忽略 PAT**（`_pat` 参数未使用）。

### 3.1 docker（`docker.provider.ts`）

- **代理**：`upstream = https://registry-1.docker.io`，无 routes；hooks 全在 `onBuildRequest`：
  - `Host: registry-1.docker.io`；UA 回退 `docker/27.0.0`；
  - `ctx.route.pat && repo` 时向 `auth.docker.io/token` 用 `Basic (patUsername||"token"):pat` 交换，成功则注入 `Bearer <token>`；
  - **无条件 `delete("Authorization")`** — 客户端自带的 Bearer token 会被删除；交换失败时 authHeader 为 null → **无认证直连 registry → 401**。
- **onSend**：仅重写 `Location`（`registry-1.docker.io` → mirror host）；**未重写 `WWW-Authenticate`**。
- **搜索**：覆写 `doSearch` — 先 `index.docker.io/v1/search`（浏览器 UA 轮换）再 `hub.docker.com/api/content/v1/products/search`（`Search-Version: v3`）兜底；**忽略 PAT**。
- **鉴权**：`authMode = "basic"`；`defineCredentialTypes` 声明 docker/ghcr/gcr/quay/k8s/nvcr 六类（后五类无实现）。
- **已知缺陷**：
  1. `/v2/` 根路径无 repo → 不交换 token → 透传上游 401 + **未重写 WWW-Authenticate** → 客户端 token 请求绕过 mirror；
  2. token 交换失败时删除客户端 Authorization（无 fallback）；
  3. 未做 `/v2/<name>` 单段镜像名 → `library/` 补全；
  4. scope 未携带 `offline_token=true`（Token 缓存/多请求复用场景可优化）；
  5. `credentials` 表未接入（见 §1.3）。

### 3.2 github（`github.provider.ts`）

- **代理**：`upstream = https://github.com`；routes：
  - `/raw/` → `https://raw.githubusercontent.com`（`stripPrefix: true`）
  - `/api/` → `https://api.github.com`（`stripPrefix: true`）
  - `/repos/` → `https://api.github.com`（原样拼接）
  - `onBuildRequest`：LFS 路径（含 `/info/lfs`）注入 `Accept: application/vnd.git-lfs+json`，其余 `application/vnd.github.v3+json`。
- **鉴权**：`authMode = "bearer"` — base 统一注入 `Authorization: Bearer <pat>`；git clone / raw / api 全部透传。
- **搜索**：覆写 `doSearch` — `api.github.com/search/repositories`，支持 `user:/org:/repo:` 限定语法，`sort=stars`，**PAT 存在时注入 Bearer**（提升速率上限）。total 上限 1000。
- **详情**：`hub` 式 info + `resolveDetailTarget` 不做转换；LFS 大文件支持依赖上游 307 → 客户端 follow（与 blob 重定向同思路）。

### 3.3 hf（`huggingface.provider.ts`）

- **代理**：`upstream = https://huggingface.co`，`exposeHeaders: true`，无 routes/hooks — 全部路径直连，PAT 由 base 注入 Bearer。
- **搜索**：覆写 `doSearch` — `Promise.allSettled` 并发 `/api/models` + `/api/datasets`（`search` / `limit=pageSize` / `sort=downloads&direction=-1`），**PAT 注入**（突破限速）；datasets 标记 `kind="dataset"`；total 取 `numTotalItems ?? numItemsPerPage`。
- **注意**：meta 描述宣称"Git LFS 支持"，但**实际无 LFS 逻辑**（仅文案）；README 依赖前端 `docBase: https://huggingface.co/{target}/raw/main/`。

### 3.4 cargo（`cargo.provider.ts`）

- **代理**：`defaultUpstream = https://static.crates.io` + routes：
  - `/api/v1/crates/` → `https://index.crates.io`（**`stripPrefix: true`**，sparse index 根路径布局）
  - `/api/v1/` → `https://crates.io`
  - `/crates/` → `https://static.crates.io`
  - `onBuildRequest`：index 前缀删除 `Accept-Encoding`（保证未压缩文本可改写）；
  - `onSend`：index 响应体 `replaceAll("https://static.crates.io", mirror)` + 删 `content-encoding`/`content-length` 重建（**download URL 重写**，crate 下载走代理）。
- **搜索**：声明式 — `https://crates.io/api/v1/crates`，`pagination: "page"`（`page`/`per_page`）。
- **鉴权**：`none`（默认可选 bearer）。

### 3.5 cpan（`cpan.provider.ts`）

- **代理**：无 routes，直连 `https://cpan.metacpan.org`（模块文件下载）。
- **搜索**：覆写 `doSearch` — `https://fastapi.metacpan.org/v1/release/_search`（**与代理上游不同主机**），ES `hits.hits` → 解 `_source`；offset 分页（`size`/`from`）；`_pat` 忽略。
- **鉴权**：`none`。

### 3.6 cran（`cran.provider.ts`）

- **代理**：无 routes，直连 `https://cloud.r-project.org`。
- **搜索**：覆写 `doSearch` — `https://crandb.r-pkg.org/-/desc?q=...`（CouchDB，**q 实为 startkey 返回全部包**），客户端按包名 `includes` 过滤 + 手工分页；**fetch 未带 UA/头**；`_pat` 忽略。
- **鉴权**：`none`。

### 3.7 dart（`dart.provider.ts`）

- **代理**：无 routes，直连 `https://pub.dev`。
- **搜索**：覆写 `doSearch` — `pub.dev/api/search?q&page`，**N+1 并发**（每结果再查 `/api/packages/{name}` 与 `/api/packages/{name}/score`）；total 用 `next` 推断；`_pat` 忽略。
- **详情**：`onInfoFetched` hook 从 `latest.pubspec.repository` 抓上游仓库 README（`utils/fetch-readme.ts`，支持 GitHub/GitLab，base64 解码），把 readme tab 从 code 改写为 markdown + 注入 `baseUrl`。

### 3.8 gomod（`gomod.provider.ts`）

- **代理**：无 routes，直连 `https://proxy.golang.org`（Go module path 原样转发）。
- **搜索**：声明式 — `https://pkg.go.dev/v1beta/search`，`pagination: "none"`（token 分页不可回溯，page 恒 1），`pageSizeParam: "limit"`。
- **鉴权**：`none`；`itemIdField: "packagePath"`（规避同 module 多 package id 重复）。

### 3.9 maven（`maven.provider.ts`）

- **代理**：无 routes，直连 `https://repo1.maven.org`（用户配置 `https://{domain}/maven2` 根路径，代理拼 path 直达 `/maven2/...`）。
- **搜索**：声明式 — `https://search.maven.org/solrsearch/select`，`pagination: "offset"`（`rows`/`start`），`extraParams: { wt: "json" }`。
- **详情**：`infoEndpoint` 用 `q=id:"{target}"`；metaFields 提供 `g`/`a`/`version` 三变量供 Gradle/Maven quickConnect 插值。

### 3.10 nuget（`nuget.provider.ts`）

- **代理**：无 routes，直连 `https://api.nuget.org`（用户配置 `https://{domain}/v3/index.json`）。
- **搜索**：声明式 — `https://azuresearch-usnc.nuget.org/query`，`pagination: "offset"`（`take`/`skip`），`extraParams: { prerelease: "false" }`。

### 3.11 npm（`npm.provider.ts`）

- **代理**：无 routes，直连 `https://registry.npmjs.org`（含 `/-/v1/search`、包元数据、tarball）。
- **搜索**：声明式 — `https://registry.npmjs.org/-/v1/search`，`queryParam: "text"`，`pagination: "offset"`（`size`/`from`）。
- **README**：走 `/readme` text 端点。
- ⚠️ **无 patch 重写逻辑**（tarball 下载、metadata 均为原样透传；若上游对 Worker IP 限速，暂无 UA 伪装手段）。

### 3.12 packagist（`packagist.provider.ts`）

- **代理**：无 routes，直连 `https://repo.packagist.org`（Composer 仓库）。
- **搜索**：声明式 — `https://packagist.org/search.json`，`pagination: "page"`（`page`/`per_page`）。
- **详情**：versions tab 数据是 `{version: {...}}` 对象而非数组（前端按 table columns 读 `version`/`version_normalized`/`type`）。

### 3.13 pypi（`pypi.provider.ts`）

- **代理**：routes：`/packages/`、`/files/` → `https://files.pythonhosted.org`（包文件 CDN）；`onBuildRequest` 对 `/simple/` 删 `Accept-Encoding`；`onSend` 对 `/simple/` 响应体 `replaceAll("https://files.pythonhosted.org", mirror)` + 删 `content-encoding`/`content-length` 重建（**simple index 链接重写**）。
- **搜索**：覆写 `doSearch` 双策略 — ① `/pypi/{query}/json` 精确匹配（UA `CloudMirror/4.0`）；② `/search/?q=` HTML 页（**浏览器样式 UA + Accept-Language**）正则抓 `package-snippet` 解实体；合并去重、精确命中排第一、客户端分页；`_pat` 忽略。
- **详情**：README 从 `/pypi/{target}/json` 的 `info.description`。

### 3.14 rubygems（`rubygems.provider.ts`）

- **代理**：无 routes，直连 `https://rubygems.org`（gem 下载 `/gems/xxx.gem` 原样转发，**无独立 CDN 路由**）。
- **搜索**：覆写 `doSearch` — `rubygems.org/api/v1/search.json?query=`（UA `CloudMirror/4.0`），上游返回全量、客户端 `slice` 分页；`_pat` 忽略。
- **详情**：versions tab 走 `/api/v1/versions/{target}.json`（`responsePath: ""` 整数组）。

---

## 4. Docker 401 根因分析（2026-08-03 实测）

**现象**：`docker pull` 401，`path=/v2/`，UA `containers/5.29.5 (github.com/containers/image)`（skopeo/podman 系）。

**判定过程**：
1. `/v2/` 401 本身是 OCI 协议的标准 token 挑战 —— registry 必须返回 401 + `WWW-Authenticate`，客户端据此换 token 后重试。**问题不在 401 本身，而在挑战信息的正确性**。
2. 当前 worker 对 `/v2/` **直接透传上游 401**，`WWW-Authenticate` 中的 `realm="https://auth.docker.io/token"` **未被重写**（`docker.provider.ts` `onSend` 只改 `Location`）。客户端收到后**直连 auth.docker.io 换 token**：
   - 公开镜像：匿名 token 可拉，后续带 token 重试 → worker 用 PAT 重新交换（若 PAT 有效则 200）；
   - 私有镜像 / 依赖 mirror PAT 的场景：客户端无本机 `docker login` 凭据 → auth.docker.io 拒绝 → **401**；
   - 且重试请求携带的客户端 token 在 `onBuildRequest` 中被 `delete("Authorization")`，若 PAT 交换失败则无任何认证头 → 401。
3. **PAT 是否真的到达代理链路**：若用户在前端"**访问凭据**"（`credentials` 表）配置 PAT，`resolveRoute()` 根本读不到 → `ctx.route.pat = null` → 不交换 token → 私有镜像 401。这是最可能的直接原因（用户已确认配了 PAT）。

**修复方向**（对齐 §2.3 参考实现）：
- [x] `resolveRoute()` 接入 `credentials` 表（启用 `authenticateCli` 或同等逻辑），让"访问凭据"进入 CLI 代理链路；
- [x] `docker.provider.ts` `onSend` 重写 `WWW-Authenticate` 的 `realm` → mirror host（cmliu 方式）或提供 `/v2/auth` 转发端点（ciiiii 方式）；
- [x] 处理 mirror 上的 `/token` 路径（透传到 auth.docker.io，必要时注入 Basic PAT；scope 单段镜像名补 `library/`）；
- [x] `onBuildRequest`：交换失败时**保留客户端 Authorization 作 fallback**（不要无条件 delete）；
- [x] `/v2/<name>/...` 单段镜像名 → `library/` 补全（路径 + scope）；
- [x] scope 追加 `offline_token=true`；PAT 交换结果按 repo + PAT 指纹缓存（Cache API，TTL 5min），避免一个镜像 N 个 blob 请求重复交换耗尽 PAT 配额。

### 4.1 实测结论（2026-08-03，mirror.deepwn.io 生产环境）

用 curl 全链路实测 + D1 查库确认：

1. `/v2/` → 401 + `WWW-Authenticate: Bearer realm="https://{mirror}/token"`（realm 重写 ✓）
2. `/token?service=...&scope=...` → 200 + JWT（透传 ✓）
3. 带 token 请求 manifests → **429 Too Many Requests**（`ratelimit-remaining: 0`，`docker-ratelimit-source` 为 Cloudflare 出口 IP）

**根因：Docker Hub 对 Cloudflare Worker IP 的匿名限额（100 pulls/hour）已打满**，而用户配置的 PAT **从未写入系统** —— D1 三层全部为空：

| 表 | 查询结果 |
|---|---|
| `user_providers`（docker） | `pat IS NULL`、`pat_username IS NULL` |
| `credentials` | 空表 |
| `provider_settings`（docker） | 无记录（无 `fallback_pat`） |

修复后 401 已解决；继续 429 的唯一原因是匿名限额耗尽。**必须配置 PAT**：在 UI「上游管理 → Docker → 全局令牌（用户名 + Access Token）」或「访问凭据」保存。PAT 生效后 `/token` 注入 Basic PAT → 客户端拿到 **PAT token**（限额 5000/hr 按用户），服务端交换亦用 PAT，不再按 CF IP 匿名限额。此外 `_base.ts` 默认 Bearer PAT 注入被 docker 覆盖为 Basic 交换，属预期。

---

## 5. GitHub 参考项目清单

| 项目 | 地址 | 参考价值 |
|---|---|---|
| cmliu/CF-Workers-docker.io | `github.com/cmliu/CF-Workers-docker.io`（`_worker.js`） | 最流行的 Docker Hub 加速 Worker：服务端 token 交换、`WWW-Authenticate` realm 重写、`/v2/` library 补全、`/token` 路径透传、blob 307 Location 重写、UA 黑名单 |
| ciiiii/cloudflare-docker-proxy | `github.com/ciiiii/cloudflare-docker-proxy`（`src/index.js`） | 多 registry 路由（docker/quay/gcr/k8s/ghcr/cloudsmith/ecr）：`/v2/` 401 时自建 `WWW-Authenticate realm="…/v2/auth"` 挑战、`/v2/auth` 服务端转发 token（透传客户端 Authorization）、`parseAuthenticate` 解析 realm/service、DockerHub library 补全（路径+scope）、blob 307 手动 follow |
| iamsdas/cloudflare-docker-proxy | `github.com/iamsdas/cloudflare-docker-proxy` | 同类多 registry 代理（索引暂未就绪，未取码，可后续补读） |
| DaoCloud/public-image-mirror | `github.com/DaoCloud/public-image-mirror` | 自建镜像站思路（非 Worker），多 registry 统一入口参考 |

**关键启发**（均已在 §2.3 / §4 落地为修复方向）：
1. 客户端 token 流程必须走 mirror（realm 重写），否则 PAT 失效；
2. `/v2/` 的 401 挑战是协议正常行为，关键是让挑战"指向自己"；
3. Docker Hub 镜像名 `library/` 补全必须做，否则单段镜像名 401/404；
4. blob CDN 307 需手动处理，否则客户端拿到的是上游 CDN 地址。

---

## 6. 审计问题清单（按优先级）

| # | 严重度 | 问题 | 影响 | 位置 |
|---|---|---|---|---|
| 1 | 🔴 高 | `credentials` 表未接入 CLI 代理链路（`authenticateCli` 未被调用） | 用户配的"访问凭据"对 docker pull / git clone 完全无效 → 私有源 401 | `worker/index.ts` + `worker/router.ts` |
| 2 | 🔴 高 | docker `WWW-Authenticate` realm 未重写 | 客户端 token 请求绕过 mirror，PAT 失效 | `docker.provider.ts` `onSend` |
| 3 | 🔴 高 | docker token 交换失败时无条件删除客户端 Authorization | 无 fallback → 401 | `docker.provider.ts` `onBuildRequest` |
| 4 | 🟠 中 | docker `/v2/` 单段镜像名未补 `library/` | `nginx` 形式 pull 在非 Docker CLI 客户端（skopeo/podman）可能 401/404 | `docker.provider.ts` |
| 5 | 🟠 中 | ghcr/gcr/quay/k8s/nvcr 仅有凭据类型声明，无代理/token 交换实现 | 这些"凭据"实际不生效 | `docker.provider.ts` `defineCredentialTypes` + `config.ts` |
| 6 | 🟡 低 | hf "LFS 支持" 仅为文案，无 LFS 逻辑 | 大文件下载体验与描述不符 | `huggingface.provider.ts` |
| 7 | 🟡 低 | cran 搜索 fetch 未带 UA/头；npm 无 UA 伪装 | 上游风控误伤风险 | `cran.provider.ts` / `npm.provider.ts` |
| 8 | 🟡 低 | docker token 交换无缓存、scope 无 `offline_token` | auth.docker.io 调用频繁、多请求重复交换 | `docker.provider.ts` |

---

## 7. 汇总对照表

| Provider | upstream | authMode | 代理 routes | hooks（特殊处理） | 搜索方式 | PAT 消费 |
|---|---|---|---|---|---|---|
| docker | registry-1.docker.io | basic | 无 | token 交换 / Location 重写 | 覆写（v1+v3 兜底） | ✅（交换） |
| github | github.com | bearer | 3（raw/api/repos） | LFS Accept | 覆写 | ✅（直通+搜索） |
| hf | huggingface.co | bearer | 无 | exposeHeaders | 覆写（双端点并发） | ✅（搜索） |
| cargo | static.crates.io | none | 3（index stripPrefix） | index 链接重写 | 声明式 page | ❌ |
| cpan | cpan.metacpan.org | none | 无 | — | 覆写（ES） | ❌ |
| cran | cloud.r-project.org | none | 无 | — | 覆写（客户端过滤） | ❌ |
| dart | pub.dev | none | 无 | detail README hook | 覆写（N+1） | ❌ |
| gomod | proxy.golang.org | none | 无 | — | 声明式 none | ❌ |
| maven | repo1.maven.org | none | 无 | — | 声明式 offset | ❌ |
| nuget | api.nuget.org | none | 无 | — | 声明式 offset | ❌ |
| npm | registry.npmjs.org | none | 无 | — | 声明式 offset | ❌ |
| packagist | repo.packagist.org | none | 无 | — | 声明式 page | ❌ |
| pypi | pypi.org | none | 2（files CDN） | /simple 链接重写 | 覆写（双策略） | ❌ |
| rubygems | rubygems.org | none | 无 | — | 覆写（客户端分页） | ❌ |
