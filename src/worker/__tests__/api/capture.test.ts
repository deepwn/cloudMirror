// ============================================================================
// src/worker/__tests__/api/capture.test.ts — /cloudmirror-api/v1/capture 测试
// ============================================================================

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createMockDB, seedUsers, createTestToken } from "../helpers/d1-mock";
import { handleCaptureRoute } from "../../api/capture";
import {
  createCaptureSession,
  getCaptureSessionByHash,
  getCaptureLogs,
  getNextCaptureSeq,
  insertCaptureLog,
} from "../../db";

const TEST_JWT_SECRET = "abcdef0123456789abcdef0123456789abcdef01";
const TEST_ENCRYPTION_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

const originalFetch = globalThis.fetch;

let db: D1Database;

function makeEnv(): any {
  return {
    DB: db,
    JWT_SECRET: TEST_JWT_SECRET,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  };
}

describe("capture API", () => {
  let regularId: string;

  beforeAll(async () => {
    db = createMockDB();
    const { regularUser } = await seedUsers(db);
    regularId = regularUser.id;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  const API = "https://mirror.example.com/cloudmirror-api/v1/capture";

  it("未登录应返回 401", async () => {
    const req = new Request(API, { method: "GET" });
    const res = await handleCaptureRoute(req, makeEnv(), "/capture");
    expect(res.status).toBe(401);
  });

  it("创建会话 → 返回专属 hash 子域", async () => {
    const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);
    const req = new Request(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "docker-test", mode: "challenge" }),
    });
    const res = await handleCaptureRoute(req, makeEnv(), "/capture");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; hash: string; mode: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.hash).toMatch(/^[a-f0-9]{16}$/);
    expect(body.data.mode).toBe("challenge");
  });

  it("transparent 模式必须提供 target_upstream", async () => {
    const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);
    const req = new Request(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "transparent" }),
    });
    const res = await handleCaptureRoute(req, makeEnv(), "/capture");
    expect(res.status).toBe(400);
  });

  it("会话列表应返回用户创建的会话", async () => {
    const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);
    await createCaptureSession(db, regularId, "s1", "aaaaaaaaaaaaaaaa", "echo", null, null, 200, null, null);
    await createCaptureSession(db, regularId, "s2", "bbbbbbbbbbbbbbbb", "transparent", "https://registry-1.docker.io", "https://auth.docker.io", 200, null, null);

    const req = new Request(API, { headers: { Authorization: `Bearer ${token}` } });
    const res = await handleCaptureRoute(req, makeEnv(), "/capture");
    const body = (await res.json()) as { success: boolean; data: Array<{ hash: string }> };
    expect(body.success).toBe(true);
    const hashes = body.data.map((d) => d.hash);
    expect(hashes).toContain("aaaaaaaaaaaaaaaa");
    expect(hashes).toContain("bbbbbbbbbbbbbbbb");
  });

  it("transparent 录制：getNextCaptureSeq 递增 + 日志可查", async () => {
    const s = await createCaptureSession(
      db,
      regularId,
      "t",
      "cccccccccccccccc",
      "transparent",
      "https://registry-1.docker.io",
      "https://auth.docker.io",
      200,
      null,
      null,
    );
    // 空表 → seq=1
    expect(await getNextCaptureSeq(db, s.id)).toBe(1);
    // 插入一条日志 → 下一条 seq=2
    await insertCaptureLog(
      db,
      s.id,
      1,
      "GET",
      "/v2/",
      "{}",
      null,
      401,
      '{"www-authenticate":"..."}',
      '{"errors":[]}',
      "1.2.3.4",
      "docker/27.0.0",
    );
    expect(await getNextCaptureSeq(db, s.id)).toBe(2);

    const byHash = await getCaptureSessionByHash(db, "cccccccccccccccc");
    expect(byHash).not.toBeNull();
    expect(byHash!.mode).toBe("transparent");
    expect(byHash!.target_upstream).toBe("https://registry-1.docker.io");

    const logs = await getCaptureLogs(db, s.id);
    expect(logs.length).toBe(1);
    expect(logs[0].method).toBe("GET");
    expect(logs[0].path).toBe("/v2/");
    expect(logs[0].resp_status).toBe(401);
  });
});
