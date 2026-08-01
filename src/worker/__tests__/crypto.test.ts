// ============================================================================
// src/worker/__tests__/crypto.test.ts — PBKDF2 & AES-256-GCM 测试
// ============================================================================

import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, encryptSecret, decryptSecret, randomHex } from "../crypto";

// 测试用加密密钥 (64 hex chars = 32 bytes = AES-256)
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("crypto", () => {
  // =========================================
  // PBKDF2 密码哈希
  // =========================================

  describe("hashPassword / verifyPassword", () => {
    it("应生成 $pdkdf2$ 格式的哈希", async () => {
      const hash = await hashPassword("test123456");
      expect(hash).toMatch(/^\$pdkdf2\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    });

    it("相同密码应验证成功", async () => {
      const hash = await hashPassword("mypassword");
      const valid = await verifyPassword("mypassword", hash);
      expect(valid).toBe(true);
    });

    it("错误密码应验证失败", async () => {
      const hash = await hashPassword("correct");
      const valid = await verifyPassword("wrong", hash);
      expect(valid).toBe(false);
    });

    it("不同盐值应生成不同哈希", async () => {
      const h1 = await hashPassword("same-password");
      const h2 = await hashPassword("same-password");
      expect(h1).not.toBe(h2);
      // 但两个都应可验证
      expect(await verifyPassword("same-password", h1)).toBe(true);
      expect(await verifyPassword("same-password", h2)).toBe(true);
    });

    it("空密码应被拒绝（安全约束）", async () => {
      // hashPassword 对空密码抛错，防止弱密码入库
      await expect(hashPassword("")).rejects.toThrow();
      // 空密码验证一律失败
      const hash = await hashPassword("valid-pass");
      expect(await verifyPassword("", hash)).toBe(false);
    });

    it("特殊字符密码应正确处理", async () => {
      const pw = "!@#$%^&*()_+-=[]{}|;:,.<>?/~`中文日本語🎉";
      const hash = await hashPassword(pw);
      expect(await verifyPassword(pw, hash)).toBe(true);
    });

    it("非法存储格式应返回 false", async () => {
      expect(await verifyPassword("any", "not-valid-format")).toBe(false);
      expect(await verifyPassword("any", "$wrong$format$test")).toBe(false);
    });

    it("篡改哈希中任一字段应验证失败", async () => {
      const hash = await hashPassword("password");
      // 修改 hash 部分的最后一个字符
      const tampered = hash.slice(0, -1) + (hash[hash.length - 1] === "A" ? "B" : "A");
      expect(await verifyPassword("password", tampered)).toBe(false);
    });
  });

  // =========================================
  // AES-256-GCM 凭据加解密
  // =========================================

  describe("encryptSecret / decryptSecret", () => {
    it("加密后解密应得到原文", async () => {
      const plain = "ghp_abcdef1234567890githubtoken";
      const encrypted = await encryptSecret(plain, TEST_KEY);
      const decrypted = await decryptSecret(encrypted, TEST_KEY);
      expect(decrypted).toBe(plain);
    });

    it("相同明文每次加密应产生不同密文 (随机IV)", async () => {
      const plain = "test-secret-token";
      const e1 = await encryptSecret(plain, TEST_KEY);
      const e2 = await encryptSecret(plain, TEST_KEY);
      expect(e1).not.toBe(e2);
    });

    it("错误密钥解密应抛出异常", async () => {
      const wrongKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
      const encrypted = await encryptSecret("my-token", TEST_KEY);
      await expect(decryptSecret(encrypted, wrongKey)).rejects.toThrow();
    });

    it("篡改密文应抛出异常", async () => {
      const encrypted = await encryptSecret("my-token", TEST_KEY);
      // 修改密文中部的字节
      const bytes = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
      bytes[Math.floor(bytes.length / 2)] ^= 0xff; // 翻转一个字节
      const tampered = btoa(String.fromCharCode(...bytes));
      await expect(decryptSecret(tampered, TEST_KEY)).rejects.toThrow();
    });

    it("空字符串应能正常加解密", async () => {
      const encrypted = await encryptSecret("", TEST_KEY);
      const decrypted = await decryptSecret(encrypted, TEST_KEY);
      expect(decrypted).toBe("");
    });

    it("长 token (1KB) 应能正确处理", async () => {
      const longToken = "A".repeat(1024);
      const encrypted = await encryptSecret(longToken, TEST_KEY);
      const decrypted = await decryptSecret(encrypted, TEST_KEY);
      expect(decrypted).toBe(longToken);
    });

    it("包含 Unicode 的凭据应正确处理", async () => {
      const token = "token-with-emoji-🎉-中文";
      const encrypted = await encryptSecret(token, TEST_KEY);
      const decrypted = await decryptSecret(encrypted, TEST_KEY);
      expect(decrypted).toBe(token);
    });
  });

  // =========================================
  // randomHex
  // =========================================

  describe("randomHex", () => {
    it("应生成指定长度的 hex 字符串", () => {
      expect(randomHex(16)).toHaveLength(16);
      expect(randomHex(32)).toHaveLength(32);
      expect(randomHex(8)).toHaveLength(8);
    });

    it("应仅包含 hex 字符", () => {
      const hex = randomHex(100);
      expect(hex).toMatch(/^[0-9a-f]{100}$/);
    });

    it("每次调用应产生不同结果", () => {
      const results = new Set(Array.from({ length: 10 }, () => randomHex(16)));
      expect(results.size).toBe(10);
    });
  });
});
