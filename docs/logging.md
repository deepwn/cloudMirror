# cloudMirror 日志分层规范

> 定位：**运维参考** — 各类日志的记录内容、存放位置、大小保护与清理策略。
> 最后更新：2026-08-04（统一日志规范落地）

---

## 1. 设计原则

1. **分层存放**：不同目的的日志放不同表，避免互相污染、避免大块数据打爆审计表。
2. **审计只存摘要**：`audit_logs` 的 `detail` 统一截断至 **2KB**（`logAudit` 强制）。
3. **调试详情独立**：大请求/响应体放 `capture_logs`（独立、按会话隔离、可导出），不写入审计。
4. **超长保护**：所有写入 D1 的 body/headers 字段统一截断（body 64KB、headers 8KB）。
5. **有清理**：所有表都有 cron 滚动清理，防止 D1 配额/行数被打爆。

## 2. 日志分层总览

| 层 | 表 | 记录内容 | 大小上限 | 清理策略 |
|---|---|---|---|---|
| **审计事件** | `audit_logs` | 登录/登出、用户管理、凭据管理、设置变更、子域轮换、邀请、代理请求摘要、调试/录制事件摘要 | detail ≤ **2KB** | cron：保留 90 天 + 硬上限 10 万行 |
| **用量统计** | `usage_logs` | 每次代理请求的 provider/path/method/status/字节/耗时/IP | 每行小 | cron：保留 90 天 |
| **聚合用量** | `daily_usage` | 按用户/日聚合的请求数、字节（dashboard 图表） | 每行小 | 随 usage_logs 重建 |
| **调试详情** | `capture_logs` | 录制会话的请求/响应详情（method/path/headers/body/resp_status/resp_body） | body ≤ **64KB**、headers ≤ **8KB**、每会话 ≤ **1000 条** | cron：保留 30 天；会话删除级联 |

## 3. 各类日志应出现的位置

| 事件类型 | 写入表 | 说明 |
|---|---|---|
| 登录成功/失败/爆破封禁 | `audit_logs` | 安全事件，摘要即可 |
| 用户创建/封禁/删除/还原/密码重置 | `audit_logs` | 管理操作，记录 actor + 目标 |
| 凭据添加/删除、子域轮换 | `audit_logs` | 敏感操作 |
| 设置变更、邀请创建 | `audit_logs` | 管理操作 |
| **代理请求** | `audit_logs`(摘要) + **`usage_logs`**(统计) | 审计存摘要（type/path/status/ratelimit），用量存统计供图表 |
| **debug-fetch 调用** | `audit_logs`（摘要） | 记录 who/when/url/status/duration；**响应体不落库**（返回给用户即可） |
| **capture 录制** | `audit_logs`(摘要) + **`capture_logs`**(详情) | 审计存摘要（session/method/path/seq/status），详情独立存放 |

**核心决策**：
- **调试详情不进审计**。debug-fetch 的响应体、capture 的请求/响应体都放在调试专属存储（capture_logs），审计只记录"发生了什么操作"。
- 需要回看调试详情 → 调试工具 → 流量录制（按会话隔离、可导出 JSONL）。
- 避免把大块数据写入高频审计表导致 D1 膨胀。

## 4. 大小保护实现

| 位置 | 保护 |
|---|---|
| `logAudit()` | detail 超过 2KB → 截断 + `…(truncated)` |
| `truncateCaptureField()` | 统一截断工具（body 64KB / headers 8KB） |
| `handleCaptureRequest` / `handleTransparentCapture` | 请求/响应体、headers 均经 `truncateCaptureField` |
| `trimCaptureLogs()` | 每个录制会话最多 1000 条日志，超出删最老 |

## 5. 清理策略（cron，每日 03:00）

| 任务 | 清理内容 |
|---|---|
| `cleanup-logs` | `usage_logs` 保留 90 天（可配 `log_retention_days`） |
| `cleanup-audit` | `audit_logs` 保留 90 天 + 硬上限 10 万行（可配 `audit_max_rows`） |
| `cleanup-capture` | `capture_logs`/`capture_sessions` 保留 30 天（可配 `capture_retention_days`） |
| `daily-cleanup` | 软删除超 72h 用户 + 过期邀请码 |
| `expire-limits` | 暂停配额过期用户 |

> 所有删除均分批（`CRON_BATCH_LIMIT=5000`/次），防止单次 cron 超 D1 配额。

## 6. 新增事件类型需同步

新增 `logAudit` 事件时，同步维护：
1. `src/worker/db.ts` → `EVENT_LABEL_TO_NAME`（中文搜索映射）
2. `src/components/settings/AuditLogPanel.tsx` → `EVENT_LABELS`（展示标签）+ `EVENT_ICONS`（图标）+ `eventVariant`（颜色）
