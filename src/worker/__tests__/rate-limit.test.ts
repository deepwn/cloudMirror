// ============================================================================
// src/worker/__tests__/rate-limit.test.ts — 速率限制与暴力探测测试
// ============================================================================

import { describe, it, expect } from "vitest";
import { checkRateLimit, recordInvalidHash, getClientIP } from "../rate-limit";

// 注意：checkRateLimit 和 recordInvalidHash 都使用模块级别的 Map，
// 因此 beforeEach 中无法轻易重置。这些测试按顺序运行。

describe("rate-limit", () => {
  // =========================================
  // checkRateLimit
  // =========================================

  describe("checkRateLimit", () => {
    it("首次请求应放行", () => {
      const ip = `test-ip-${Math.random()}`;
      const result = checkRateLimit(ip, 10);
      expect(result).toBeNull();
    });

    it("maxReq=5 应在第 6 次触发限速", () => {
      const ip = `test-ip-${Math.random()}`;

      for (let i = 0; i < 5; i++) {
        expect(checkRateLimit(ip, 5)).toBeNull();
      }
      const blocked = checkRateLimit(ip, 5);
      expect(blocked).not.toBeNull();
      expect(blocked!.status).toBe(429);
    });

    it("maxReq=0 或无效时应使用默认值", () => {
      const ip = `test-ip-${Math.random()}`;
      expect(checkRateLimit(ip, 0)).toBeNull();
      expect(checkRateLimit(ip, NaN)).toBeNull();
    });

    it("不同 IP 应独立计数", () => {
      const ip1 = `test-ip-${Math.random()}`;
      const ip2 = `test-ip-${Math.random()}`;

      expect(checkRateLimit(ip1, 2)).toBeNull();
      expect(checkRateLimit(ip1, 2)).toBeNull();
      expect(checkRateLimit(ip1, 2)?.status).toBe(429);

      expect(checkRateLimit(ip2, 2)).toBeNull();
    });
  });

  // =========================================
  // recordInvalidHash
  // =========================================

  describe("recordInvalidHash", () => {
    it("第 1-2 次无效 hash 应放行但计数", () => {
      const ip = `test-hash-${Math.random()}`;
      expect(recordInvalidHash(ip).response).toBeUndefined();
      expect(recordInvalidHash(ip).response).toBeUndefined();
    });

    it("达到阈值应返回 shouldBan 信号和 429", async () => {
      const ip = `test-hash-${Math.random()}`;
      recordInvalidHash(ip, 3); // 1
      recordInvalidHash(ip, 3); // 2
      const result = recordInvalidHash(ip, 3); // 3 → ban
      expect(result.shouldBan).toBe(ip);
      expect(result.response).not.toBeUndefined();
      expect(result.response!.status).toBe(429);
    });

    it("已封禁后继续返回 429 但不重复 signal", () => {
      const ip = `test-hash-${Math.random()}`;
      recordInvalidHash(ip, 2); // 1
      const first = recordInvalidHash(ip, 2); // 2 → ban
      expect(first.shouldBan).toBe(ip);
      const second = recordInvalidHash(ip, 2); // already banned
      expect(second.shouldBan).toBeUndefined();
      expect(second.response).not.toBeUndefined();
    });
  });

  // =========================================
  // getClientIP
  // =========================================

  describe("getClientIP", () => {
    it("应优先取 CF-Connecting-IP", () => {
      const req = new Request("https://example.com/", {
        headers: {
          "CF-Connecting-IP": "1.2.3.4",
          "X-Forwarded-For": "5.6.7.8",
          "X-Real-IP": "9.10.11.12",
        },
      });
      expect(getClientIP(req)).toBe("1.2.3.4");
    });

    it("无 CF-Connecting-IP 时应取 X-Forwarded-For", () => {
      const req = new Request("https://example.com/", {
        headers: { "X-Forwarded-For": "10.0.0.1" },
      });
      expect(getClientIP(req)).toBe("10.0.0.1");
    });

    it("无任何 IP 头时应返回 unknown", () => {
      const req = new Request("https://example.com/");
      expect(getClientIP(req)).toBe("unknown");
    });
  });
});
