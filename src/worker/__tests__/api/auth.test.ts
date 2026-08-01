// ============================================================================
// src/worker/__tests__/api/auth.test.ts — /cloudmirror-api/v1/auth/* 集成测试
// ============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import { createMockDB, seedUsers, createTestToken } from "../helpers/d1-mock";
import { authHandlers } from "../../api/auth";
import { hashPassword } from "../../crypto";

const TEST_JWT_SECRET = "abcdef0123456789abcdef0123456789abcdef01";
const TEST_ENCRYPTION_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

describe("auth API", () => {
  let db: D1Database;
  let adminId: string;
  let regularId: string;
  let adminPwHash: string;
  let regularPwHash: string;

  beforeAll(async () => {
    db = createMockDB();
    const { adminUser, regularUser } = await seedUsers(db);

    adminId = adminUser.id;
    regularId = regularUser.id;

    // 生成真实的 PBKDF2 哈希
    adminPwHash = await hashPassword("admin123");
    regularPwHash = await hashPassword("testpass");

    // 更新数据库中的密码哈希
    await db.prepare("UPDATE users SET password = ? WHERE id = ?").bind(adminPwHash, adminId).run();
    await db
      .prepare("UPDATE users SET password = ? WHERE id = ?")
      .bind(regularPwHash, regularId)
      .run();
  });

  function makeEnv(): any {
    return {
      DB: db,
      JWT_SECRET: TEST_JWT_SECRET,
      ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    };
  }

  // =========================================
  // Login
  // =========================================

  describe("login", () => {
    it("正确凭据应返回 token 和用户信息", async () => {
      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.1.1.1" },
        body: JSON.stringify({ username: "admin", password: "admin123" }),
      });

      const res = await authHandlers.login(req, makeEnv());
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        token: string;
        user: { username: string; role: string };
      };
      expect(body.token).toBeDefined();
      expect(body.user.username).toBe("admin");
      expect(body.user.role).toBe("admin");
    });

    it("错误密码应返回 401", async () => {
      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "wrongpass" }),
      });

      const res = await authHandlers.login(req, makeEnv());
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe("invalid credentials");
    });

    it("不存在的用户应返回 401", async () => {
      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "nonexistent", password: "whatever" }),
      });

      const res = await authHandlers.login(req, makeEnv());
      expect(res.status).toBe(401);
    });

    it("缺少字段应返回 400", async () => {
      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin" }),
      });

      const res = await authHandlers.login(req, makeEnv());
      expect(res.status).toBe(400);
    });

    it("非法 JSON 应返回 400", async () => {
      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });

      const res = await authHandlers.login(req, makeEnv());
      expect(res.status).toBe(400);
    });

    it("被暂停用户应返回 401", async () => {
      // suspended 用户的密码哈希尚未更新，但我们验证的是 status 检查
      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "suspended", password: "whatever" }),
      });

      const res = await authHandlers.login(req, makeEnv());
      expect(res.status).toBe(401);
    });
  });

  // =========================================
  // Register
  // =========================================

  describe("register", () => {
    it("默认 invite 模式缺邀请码应拒绝注册", async () => {
      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "newuser", password: "password123" }),
      });

      const res = await authHandlers.register(req, makeEnv());
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe("invite code required");
    });

    it("open 模式应允许注册", async () => {
      // 先改设置
      await db
        .prepare("UPDATE settings SET value = ? WHERE key = ?")
        .bind("open", "registration_mode")
        .run();

      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json", CF_CONNECTING_IP: "2.2.2.2" },
        body: JSON.stringify({ username: "newbie", password: "mypassword123" }),
      });

      const res = await authHandlers.register(req, makeEnv());
      expect(res.status).toBe(200);

      const body = (await res.json()) as { token: string; user: { username: string } };
      expect(body.token).toBeDefined();
      expect(body.user.username).toBe("newbie");
    });

    it("已存在的用户名应返回 409", async () => {
      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password123" }),
      });

      const res = await authHandlers.register(req, makeEnv());
      expect(res.status).toBe(409);
    });

    it("用户名过短应返回 400", async () => {
      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "ab", password: "password12345678" }),
      });

      const res = await authHandlers.register(req, makeEnv());
      expect(res.status).toBe(400);
    });

    it("密码过短应返回 400", async () => {
      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "validuser", password: "short" }),
      });

      const res = await authHandlers.register(req, makeEnv());
      expect(res.status).toBe(400);
    });
  });

  // =========================================
  // Me
  // =========================================

  describe("me", () => {
    it("有效 token 应返回用户信息", async () => {
      const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);

      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const res = await authHandlers.me(req, makeEnv());
      expect(res.status).toBe(200);

      const body = (await res.json()) as { username: string; role: string };
      expect(body.username).toBe("testuser");
      expect(body.role).toBe("user");
    });

    it("缺少 token 应返回 401", async () => {
      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/auth/me");
      const res = await authHandlers.me(req, makeEnv());
      expect(res.status).toBe(401);
    });

    it("无效 token 应返回 401", async () => {
      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/auth/me", {
        headers: { Authorization: "Bearer invalid.token.here" },
      });

      const res = await authHandlers.me(req, makeEnv());
      expect(res.status).toBe(401);
    });
  });

  // =========================================
  // Rotate Hash
  // =========================================

  describe("rotateHash", () => {
    it("登录用户应能轮换 hash", async () => {
      const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);

      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/auth/rotate-hash", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      const res = await authHandlers.rotateHash(req, makeEnv());
      expect(res.status).toBe(200);

      const body = (await res.json()) as { rotated: Record<string, string> };
      expect(body.rotated).toBeDefined();
      expect(typeof body.rotated).toBe("object");
    });
  });
});
