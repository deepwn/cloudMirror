// ============================================================================
// src/worker/__tests__/api/credentials.test.ts — /cloudmirror-api/v1/credentials CRUD 测试
// ============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import { createMockDB, seedUsers, createTestToken } from "../helpers/d1-mock";
import { handleCredentialRoute } from "../../api/credentials";

const TEST_JWT_SECRET = "abcdef0123456789abcdef0123456789abcdef01";
const TEST_ENCRYPTION_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

describe("credentials API", () => {
  let db: D1Database;
  let adminId: string;
  let regularId: string;

  beforeAll(async () => {
    db = createMockDB();
    const { adminUser, regularUser } = await seedUsers(db);
    adminId = adminUser.id;
    regularId = regularUser.id;
  });

  function makeEnv(): any {
    return {
      DB: db,
      JWT_SECRET: TEST_JWT_SECRET,
      ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    };
  }

  // =========================================
  // List credentials
  // =========================================

  describe("GET (list)", () => {
    it("未登录应返回 401", async () => {
      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/credentials");
      const res = await handleCredentialRoute(req, makeEnv(), "");
      expect(res.status).toBe(401);
    });

    it("登录用户应能查看自己的凭据列表", async () => {
      const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);

      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/credentials", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const res = await handleCredentialRoute(req, makeEnv(), "");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it("应按 provider 筛选", async () => {
      const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);

      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/credentials?provider=docker", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const res = await handleCredentialRoute(req, makeEnv(), "");
      expect(res.status).toBe(200);
    });
  });

  // =========================================
  // Create credential
  // =========================================

  describe("POST (create)", () => {
    it("应创建新凭据", async () => {
      const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);

      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "CF-Connecting-IP": "10.0.0.1",
        },
        body: JSON.stringify({
          provider: "docker",
          label: "My Docker Hub",
          username: "myuser",
          secret: "mypassword12345",
        }),
      });

      const res = await handleCredentialRoute(req, makeEnv(), "");
      expect(res.status).toBe(201);

      const body = (await res.json()) as {
        success: boolean;
        data: { provider: string; username: string; secret?: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.provider).toBe("docker");
      expect(body.data.username).toBe("myuser");
      // 密钥不应暴露
      expect(body.data.secret).toBeUndefined();
    });

    it("缺少必填字段应返回 400", async () => {
      const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);

      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ provider: "docker" }),
      });

      const res = await handleCredentialRoute(req, makeEnv(), "");
      expect(res.status).toBe(400);
    });

    it("无效 provider 应返回 400", async () => {
      const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);

      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          provider: "invalid-provider",
          username: "test",
          secret: "secret",
        }),
      });

      const res = await handleCredentialRoute(req, makeEnv(), "");
      expect(res.status).toBe(400);
    });
  });

  // =========================================
  // Update credential
  // =========================================

  describe("PUT (update)", () => {
    it("应更新凭据字段", async () => {
      const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);

      // 先创建
      const createReq = new Request("https://mirror.example.com/cloudmirror-api/v1/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "CF-Connecting-IP": "10.0.0.1",
        },
        body: JSON.stringify({
          provider: "github",
          label: "Old Label",
          username: "ghuser",
          secret: "oldpat123456",
        }),
      });

      const createRes = await handleCredentialRoute(createReq, makeEnv(), "");
      const { data: created } = (await createRes.json()) as { data: { id: string } };

      // 更新
      const updateReq = new Request(`https://mirror.example.com/cloudmirror-api/v1/credentials/${created.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "CF-Connecting-IP": "10.0.0.1",
        },
        body: JSON.stringify({ label: "Updated Label", is_active: false }),
      });

      const updateRes = await handleCredentialRoute(updateReq, makeEnv(), `/${created.id}`);
      expect(updateRes.status).toBe(200);
      const body = (await updateRes.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it("无 id 应返回 400", async () => {
      const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);

      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/credentials/", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ label: "X" }),
      });

      const res = await handleCredentialRoute(req, makeEnv(), "");
      expect(res.status).toBe(400);
    });

    it("更新他人凭据应返回 403（非管理员）", async () => {
      const adminToken = await createTestToken(adminId, "admin", TEST_JWT_SECRET);
      const userToken = await createTestToken(regularId, "user", TEST_JWT_SECRET);

      // 管理员创建凭据
      const createReq = new Request("https://mirror.example.com/cloudmirror-api/v1/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
          "CF-Connecting-IP": "10.0.0.1",
        },
        body: JSON.stringify({
          provider: "docker",
          label: "Admin Cred",
          username: "adminuser",
          secret: "admin-secret-123",
        }),
      });

      const createRes = await handleCredentialRoute(createReq, makeEnv(), "");
      const { data: adminCred } = (await createRes.json()) as { data: { id: string } };

      // 普通用户尝试更新管理员的凭据
      const updateReq = new Request(`https://mirror.example.com/cloudmirror-api/v1/credentials/${adminCred.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({ label: "Hacked!" }),
      });

      const updateRes = await handleCredentialRoute(updateReq, makeEnv(), `/${adminCred.id}`);
      expect(updateRes.status).toBe(403);
    });
  });

  // =========================================
  // Delete credential
  // =========================================

  describe("DELETE", () => {
    it("应删除自己的凭据", async () => {
      const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);

      // 先创建
      const createReq = new Request("https://mirror.example.com/cloudmirror-api/v1/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "CF-Connecting-IP": "10.0.0.1",
        },
        body: JSON.stringify({
          provider: "hf",
          label: "Delete Me",
          username: "hfuser",
          secret: "hf-token-123",
        }),
      });
      const createRes = await handleCredentialRoute(createReq, makeEnv(), "");
      const { data: created } = (await createRes.json()) as { data: { id: string } };

      // 删除
      const deleteReq = new Request(`https://mirror.example.com/cloudmirror-api/v1/credentials/${created.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "CF-Connecting-IP": "10.0.0.1",
        },
      });

      const deleteRes = await handleCredentialRoute(deleteReq, makeEnv(), `/${created.id}`);
      expect(deleteRes.status).toBe(200);
    });

    it("无 id 应返回 400", async () => {
      const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);
      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/credentials/", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      const res = await handleCredentialRoute(req, makeEnv(), "");
      expect(res.status).toBe(400);
    });

    it("已删除的凭据应返回 404", async () => {
      const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);
      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/credentials/nonexistent-id", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      const res = await handleCredentialRoute(req, makeEnv(), "/nonexistent-id");
      expect(res.status).toBe(404);
    });
  });

  // =========================================
  // Edge cases
  // =========================================

  describe("edge cases", () => {
    it("非法 JSON body 应返回 400", async () => {
      const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);

      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: "{invalid json",
      });

      const res = await handleCredentialRoute(req, makeEnv(), "");
      expect(res.status).toBe(400);
    });

    it("不支持的 HTTP 方法应返回 405", async () => {
      const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);

      const req = new Request("https://mirror.example.com/cloudmirror-api/v1/credentials", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });

      const res = await handleCredentialRoute(req, makeEnv(), "");
      expect(res.status).toBe(405);
    });
  });
});
