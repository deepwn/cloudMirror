-- ============================================================
-- cloudMirror D1 Database Schema v1.0
-- ============================================================

-- 1. 用户表
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,               -- UUID v4
  username      TEXT NOT NULL UNIQUE,           -- 登录名
  password      TEXT NOT NULL,                  -- PBKDF2-SHA256 hash
  role          TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  status        TEXT NOT NULL DEFAULT 'active', -- 'active' | 'suspended' | 'deleted'
  email         TEXT DEFAULT NULL,
  note          TEXT DEFAULT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,    -- 会话版本号，递增可强制下线所有旧 JWT
  deleted_at    TEXT DEFAULT NULL,              -- 软删除时间 (ISO 8601)，72h 后由 cron 硬清理
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_status  ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at);

-- 2. 用户级 Provider 配置 (每个用户每个 provider 独立子域 + PAT)
CREATE TABLE IF NOT EXISTS user_providers (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,                   -- 对应 registry.ts 注册的 14 个 Provider id
  hash            TEXT NOT NULL UNIQUE,            -- 16 位 hex，独立子域
  enabled         INTEGER NOT NULL DEFAULT 1,
  pat             TEXT DEFAULT NULL,               -- AES-256-GCM 加密
  pat_username    TEXT DEFAULT NULL,               -- Basic Auth 用户名
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_up_hash    ON user_providers(hash);
CREATE INDEX IF NOT EXISTS idx_up_user    ON user_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_up_provider ON user_providers(provider);

-- 3. 管理员对每个 provider 的全局设置
CREATE TABLE IF NOT EXISTS provider_settings (
  provider      TEXT PRIMARY KEY,
  enabled       INTEGER NOT NULL DEFAULT 1,
  fallback_pat  TEXT DEFAULT NULL,                 -- AES-256-GCM 加密
  rate_limit    INTEGER DEFAULT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. Provider 凭据表 (PAT/Token) — 附加凭据，关联到 user_providers
CREATE TABLE IF NOT EXISTS credentials (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_provider_id TEXT REFERENCES user_providers(id),
  provider         TEXT NOT NULL,
  label            TEXT NOT NULL DEFAULT '',
  username         TEXT NOT NULL,
  secret           TEXT NOT NULL,                  -- AES-256-GCM 加密 (Base64)
  is_active        INTEGER NOT NULL DEFAULT 1,
  last_used_at     TEXT DEFAULT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cred_user_provider ON credentials(user_id, provider);

-- 5. 用户配额 / 限制表
CREATE TABLE IF NOT EXISTS user_limits (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL DEFAULT '*',    -- '*' = 全局
  rate_limit      INTEGER NOT NULL DEFAULT 600,
  bandwidth_limit INTEGER DEFAULT NULL,         -- GB/月
  concurrency     INTEGER NOT NULL DEFAULT 10,
  expires_at      TEXT DEFAULT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_limits_user ON user_limits(user_id);

-- 6. 用量记录表 (明细)
CREATE TABLE IF NOT EXISTS usage_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,
  path        TEXT NOT NULL,
  method      TEXT NOT NULL,
  status      INTEGER NOT NULL,
  bytes_in    INTEGER NOT NULL DEFAULT 0,
  bytes_out   INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  client_ip   TEXT DEFAULT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_logs(user_id, created_at);

-- 7. 每日用量汇总表
CREATE TABLE IF NOT EXISTS daily_usage (
  id          TEXT PRIMARY KEY,                 -- '{user_id}:{date}'
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  provider    TEXT NOT NULL DEFAULT '*',
  requests    INTEGER NOT NULL DEFAULT 0,
  bytes_in    INTEGER NOT NULL DEFAULT 0,
  bytes_out   INTEGER NOT NULL DEFAULT 0,
  cache_hits  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, date, provider)
);
CREATE INDEX IF NOT EXISTS idx_daily_user_date ON daily_usage(user_id, date);

-- 8. 审计日志表
CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT DEFAULT NULL,
  actor_ip    TEXT DEFAULT NULL,
  actor_ua    TEXT DEFAULT NULL,
  event       TEXT NOT NULL,
  target_type TEXT DEFAULT NULL,
  target_id   TEXT DEFAULT NULL,
  detail      TEXT DEFAULT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_event_time ON audit_logs(event, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor      ON audit_logs(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_ip          ON audit_logs(actor_ip, created_at);

-- 9. 系统设置表
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT DEFAULT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 10. 登录会话表
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_version INTEGER NOT NULL DEFAULT 0,
  client_ip     TEXT DEFAULT NULL,
  client_ua     TEXT DEFAULT NULL,
  is_current    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 11. 邀请码表
CREATE TABLE IF NOT EXISTS invite_codes (
  id            TEXT PRIMARY KEY,               -- UUID v4
  code          TEXT NOT NULL UNIQUE,           -- 32 位 hex 邀请码
  created_by    TEXT NOT NULL REFERENCES users(id),
  max_uses      INTEGER NOT NULL DEFAULT 1,     -- 最大使用次数，1=一次性
  used_count    INTEGER NOT NULL DEFAULT 0,
  expires_at    TEXT NOT NULL,                  -- 过期时间 (ISO 8601)
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invite_code ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_invite_expires ON invite_codes(expires_at);

-- ============================================================
-- 默认设置（种子数据内联于此；历史 scripts/db-init.ts 已移除）
-- ============================================================
INSERT OR IGNORE INTO settings (key, value, description) VALUES
  ('registration_mode', 'invite', '注册模式: open | invite | closed'),
  ('site_notice', '', '公告文本 (Markdown)'),
  ('site_name', 'cloudMirror', '站点名称'),
  ('rate_limit', '600', '全局限速：每分钟最大请求数'),
  ('allow_push_upload', '0', '是否允许推送/上传 (0|1)'),
  ('brute_limit_attempts', '5', '爆破保护：最大失败尝试次数（登录失败 / 子域 Hash 猜测）'),
  ('log_retention_days', '90', '日志统一保留天数（审计+用量）'),
  ('audit_max_rows', '100000', '审计日志最大行数'),
  ('pwd_min_length', '8', '密码最小长度'),
  ('pwd_require_number', '0', '密码是否要求数字 (0|1)'),
  ('pwd_require_symbol', '0', '密码是否要求符号 (0|1)'),
  ('user_blacklist', '', '用户黑名单（用户名逗号分隔）'),
  ('ip_blacklist', '', 'IP 黑名单（逗号分隔）'),
  ('ip_whitelist', '', 'IP 白名单（逗号分隔）'),
  ('ua_block', '', 'UA 黑名单关键词（逗号分隔）');
