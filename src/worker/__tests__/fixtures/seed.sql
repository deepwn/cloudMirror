-- ============================================================
-- 测试用种子数据 (仅供参考，实际测试使用内存 mock)
-- ============================================================

-- 管理员
INSERT INTO users (id, username, password, hash, role, status)
VALUES ('user-admin-001', 'admin', '$pdkdf2$600000$testsalt$testhash', 'a1b2c3d4e5f6a7b8', 'admin', 'active');

-- 普通用户
INSERT INTO users (id, username, password, hash, role, status)
VALUES ('user-regular-001', 'testuser', '$pdkdf2$600000$testsalt$testhash', 'deadbeefcafe1234', 'user', 'active');

-- 暂停用户
INSERT INTO users (id, username, password, hash, role, status)
VALUES ('user-suspended-001', 'suspended', '$pdkdf2$600000$testsalt$testhash', 'badc0debadc0de00', 'user', 'suspended');

-- 系统设置
INSERT INTO settings (key, value, description) VALUES ('registration_mode', 'invite', 'open | invite | closed');

-- 测试凭据
INSERT INTO credentials (id, user_id, provider, label, username, secret, is_active)
VALUES ('cred-001', 'user-regular-001', 'docker', 'Docker Hub', 'testuser', 'encrypted-secret-base64', 1);
