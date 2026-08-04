// ============================================================================
// src/worker/__tests__/api/debug.test.ts — /cloudmirror-api/v1/debug-fetch 测试
// ============================================================================

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createMockDB, seedUsers, createTestToken } from "../helpers/d1-mock";
import { handleDebugFetchRoute } from "../../api/debug";

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

function jsonRequest(url: string, token: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("debug-fetch API", () => {
  let adminId: string;
  let regularId: string;

  beforeAll(async () => {
    db = createMockDB();
    const { adminUser, regularUser } = await seedUsers(db);
    adminId = adminUser.id;
    regularId = regularUser.id;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  const ADMIN_URL = "https://mirror.example.com/cloudmirror-api/v1/debug-fetch";

  it("未登录应返回 401", async () => {
    const req = new Request(ADMIN_URL, { method: "POST", body: "{}" });
    const res = await handleDebugFetchRoute(req, makeEnv());
    expect(res.status).toBe(401);
  });

  it("非 admin 用户应返回 403", async () => {
    const token = await createTestToken(regularId, "user", TEST_JWT_SECRET);
    const req = jsonRequest(ADMIN_URL, token, { method: "GET", url: "https://www.bing.com/" });
    const res = await handleDebugFetchRoute(req, makeEnv());
    expect(res.status).toBe(403);
  });

  it("admin 应能请求公网 URL 并返回状态/头/体", async () => {
    const token = await createTestToken(adminId, "admin", TEST_JWT_SECRET);
    const fetchMock = vi.fn(
      async () =>
        new Response('<html><title>Bing</title></html>', {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = jsonRequest(ADMIN_URL, token, { method: "GET", url: "https://www.bing.com/" });
    const res = await handleDebugFetchRoute(req, { ...makeEnv(), DB: db });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      data: {
        ok: boolean;
        status: number;
        statusText: string;
        headers: Record<string, string>;
        body: string;
        truncated: boolean;
        durationMs: number;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe(200);
    expect(body.data.body).toContain("Bing");
    expect(body.data.headers["content-type"]).toContain("text/html");
    expect(body.data.truncated).toBe(false);
    expect(body.data.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("POST 应透传 method/headers/body", async () => {
    const token = await createTestToken(adminId, "admin", TEST_JWT_SECRET);
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const headers = init?.headers as Headers;
        return new Response(
          JSON.stringify({ method: init?.method, ua: headers.get("User-Agent"), sent: init?.body }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = jsonRequest(ADMIN_URL, token, {
      method: "POST",
      url: "https://httpbin.org/post",
      headers: { "X-Test": "abc" },
      body: JSON.stringify({ hello: "world" }),
    });
    const res = await handleDebugFetchRoute(req, { ...makeEnv(), DB: db });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: { status: number; body: string } };
    expect(body.data.status).toBe(201);
    const parsed = JSON.parse(body.data.body) as { method?: string; ua?: string; sent?: string };
    expect(parsed.method).toBe("POST");
    expect(parsed.sent).toBe('{"hello":"world"}');
  });

  it("SSRF：内网 IP / metadata 应被拒绝 403（localhost/127.0.0.1 放行）", async () => {
    const token = await createTestToken(adminId, "admin", TEST_JWT_SECRET);
    for (const bad of [
      "http://10.0.0.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://172.16.0.1/",
      "https://8.8.8.8/",
      "http://[::1]/",
    ]) {
      const req = jsonRequest(ADMIN_URL, token, { method: "GET", url: bad });
      const res = await handleDebugFetchRoute(req, makeEnv());
      expect(res.status).toBe(403);
    }
    // localhost / 127.0.0.1 放行（本地 dev 调试"访问自身"）
    for (const ok of ["http://localhost:5173/health", "https://127.0.0.1:8787/"]) {
      const req = jsonRequest(ADMIN_URL, token, { method: "GET", url: ok });
      const res = await handleDebugFetchRoute(req, makeEnv());
      expect(res.status).not.toBe(403);
    }
  });

  it("非 http/https 协议应被拒绝 400", async () => {
    const token = await createTestToken(adminId, "admin", TEST_JWT_SECRET);
    const req = jsonRequest(ADMIN_URL, token, { method: "GET", url: "file:///etc/passwd" });
    const res = await handleDebugFetchRoute(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it("不支持的方法应返回 400", async () => {
    const token = await createTestToken(adminId, "admin", TEST_JWT_SECRET);
    const req = jsonRequest(ADMIN_URL, token, { method: "TRACE", url: "https://www.bing.com/" });
    const res = await handleDebugFetchRoute(req, makeEnv());
    expect(res.status).toBe(400);
  });
});
