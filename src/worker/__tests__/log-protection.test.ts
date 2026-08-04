// ============================================================================
// src/worker/__tests__/log-protection.test.ts — 日志分层与大小保护测试
// ============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import { createMockDB, seedUsers } from "./helpers/d1-mock";
import { logAudit, truncateCaptureField } from "../db";

let db: D1Database;

describe("日志分层与大小保护", () => {
  beforeAll(async () => {
    db = createMockDB();
    await seedUsers(db);
  });

  it("logAudit 应截断超长 detail（>2KB）", async () => {
    const big = "x".repeat(5000);
    await logAudit(db, "test_big_detail", {
      actorId: "u-big",
      detail: big,
    });
    const all = (await db.prepare("SELECT * FROM audit_logs").all<{ event: string; detail: string }>())
      .results;
    const row = all.find((r) => r.event === "test_big_detail");
    expect(row).toBeDefined();
    expect(row!.detail.length).toBeLessThanOrEqual(2048 + 12); // 2048 + "…(truncated)"
    expect(row!.detail.endsWith("…(truncated)")).toBe(true);
  });

  it("logAudit 应保留短 detail 原样", async () => {
    const small = JSON.stringify({ type: "docker", path: "/v2/", status: 401 });
    await logAudit(db, "test_small_detail", {
      actorId: "u-small",
      detail: small,
    });
    // 直接查全部 audit 行（mock 的 WHERE 解析较简），按事件名在结果中过滤
    const all = (await db.prepare("SELECT * FROM audit_logs").all<{ event: string; detail: string }>())
      .results;
    const row = all.find((r) => r.event === "test_small_detail");
    expect(row).toBeDefined();
    expect(row!.detail).toBe(small);
  });

  it("truncateCaptureField 应截断超过 64KB 的 body", () => {
    const big = "y".repeat(100 * 1024);
    const out = truncateCaptureField(big);
    expect(out!.length).toBeLessThanOrEqual(64 * 1024 + 12);
    expect(out!.endsWith("…(truncated)")).toBe(true);
  });

  it("truncateCaptureField 应保留短值 + null 原样", () => {
    expect(truncateCaptureField(null)).toBeNull();
    expect(truncateCaptureField("hello")).toBe("hello");
    const capped = truncateCaptureField("z".repeat(20), 10);
    expect(capped!.length).toBeLessThanOrEqual(10 + 12);
  });
});
