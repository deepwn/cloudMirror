// ============================================================================
// src/worker/__tests__/jwt.test.ts — JWT 签发与校验测试
// ============================================================================

import { describe, it, expect } from "vitest";
import { sign, verify } from "../jwt";

const TEST_SECRET = "test-jwt-secret-key-32bytes!!";

describe("jwt", () => {
  describe("sign", () => {
    it("应返回三段式 JWT 字符串", async () => {
      const token = await sign({ sub: "user-1", role: "user" }, TEST_SECRET);
      const parts = token.split(".");
      expect(parts).toHaveLength(3);
    });

    it("header 应为 HS256", async () => {
      const token = await sign({ sub: "user-1", role: "user" }, TEST_SECRET);
      const header = JSON.parse(atob(token.split(".")[0]));
      expect(header).toEqual({ alg: "HS256", typ: "JWT" });
    });

    it("自定义过期时间应生效", async () => {
      const token = await sign({ sub: "user-1", role: "user" }, TEST_SECRET, 1);
      const payload = await verify(token, TEST_SECRET);
      expect(payload).not.toBeNull();
      expect(payload!.exp! - payload!.iat!).toBe(1);
    });
  });

  describe("verify", () => {
    it("有效 token 应校验通过", async () => {
      const token = await sign({ sub: "user-abc", role: "admin" }, TEST_SECRET);
      const payload = await verify(token, TEST_SECRET);
      expect(payload).not.toBeNull();
      expect(payload!.sub).toBe("user-abc");
      expect(payload!.role).toBe("admin");
    });

    it("payload 应包含 iat 和 exp", async () => {
      const token = await sign({ sub: "u1", role: "user" }, TEST_SECRET);
      const payload = await verify(token, TEST_SECRET);
      expect(payload).not.toBeNull();
      expect(payload!.iat).toBeGreaterThan(0);
      expect(payload!.exp).toBeGreaterThan(payload!.iat!);
    });

    it("错误密钥应校验失败", async () => {
      const token = await sign({ sub: "u1", role: "user" }, TEST_SECRET);
      const payload = await verify(token, "wrong-secret");
      expect(payload).toBeNull();
    });

    it("格式错误的 token 应返回 null", async () => {
      expect(await verify("not.a.jwt.token", TEST_SECRET)).toBeNull();
      expect(await verify("only-two.parts", TEST_SECRET)).toBeNull();
      expect(await verify("", TEST_SECRET)).toBeNull();
    });

    it("过期 token 应返回 null", async () => {
      // 签发一个已过期 60 秒的 token
      const token = await sign({ sub: "u1", role: "user" }, TEST_SECRET, -60);
      const payload = await verify(token, TEST_SECRET);
      expect(payload).toBeNull();
    });

    it("篡改 payload 的 token 应校验失败", async () => {
      const token = await sign({ sub: "u1", role: "user" }, TEST_SECRET);
      const parts = token.split(".");
      // 把 payload 里的 role 改成 admin
      const origPayload = JSON.parse(atob(parts[1]));
      origPayload.role = "admin";
      const newPayload64 = btoa(JSON.stringify(origPayload));
      const tampered = `${parts[0]}.${newPayload64}.${parts[2]}`;
      const payload = await verify(tampered, TEST_SECRET);
      expect(payload).toBeNull();
    });

    it("篡改签名的 token 应校验失败", async () => {
      const token = await sign({ sub: "u1", role: "user" }, TEST_SECRET);
      const parts = token.split(".");
      // JWT 使用 base64url，需转换回标准 base64
      const sigRaw = atob(parts[2].replace(/-/g, "+").replace(/_/g, "/"));
      // 翻转签名第一个字节
      const tamperedSig = btoa(String.fromCharCode(sigRaw.charCodeAt(0) ^ 0xff) + sigRaw.slice(1));
      const tampered = `${parts[0]}.${parts[1]}.${tamperedSig.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
      const payload = await verify(tampered, TEST_SECRET);
      expect(payload).toBeNull();
    });

    it("不同密钥签发相同 payload 的 token 应互不可验证", async () => {
      const t1 = await sign({ sub: "u1", role: "user" }, "secret-a");
      const t2 = await sign({ sub: "u1", role: "user" }, "secret-b");
      expect(await verify(t1, "secret-b")).toBeNull();
      expect(await verify(t2, "secret-a")).toBeNull();
    });
  });

  describe("完整签发→校验生命周期", () => {
    it("应完整支持 admin 和 user 两种角色", async () => {
      const adminToken = await sign({ sub: "admin-1", role: "admin" }, TEST_SECRET);
      const userToken = await sign({ sub: "user-1", role: "user" }, TEST_SECRET);

      const adminP = await verify(adminToken, TEST_SECRET);
      const userP = await verify(userToken, TEST_SECRET);

      expect(adminP!.role).toBe("admin");
      expect(userP!.role).toBe("user");
      expect(adminP!.sub).not.toBe(userP!.sub);
    });

    it("多用户场景应正确隔离", async () => {
      const users = ["alice", "bob", "charlie"];
      const tokens = await Promise.all(
        users.map((u) => sign({ sub: u, role: "user" }, TEST_SECRET)),
      );

      for (let i = 0; i < users.length; i++) {
        const p = await verify(tokens[i], TEST_SECRET);
        expect(p!.sub).toBe(users[i]);
      }
    });
  });
});
