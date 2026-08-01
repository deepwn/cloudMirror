// ============================================================================
// src/worker/__tests__/router.test.ts — v1.0 子域名解析测试
// ============================================================================

import { describe, it, expect } from "vitest";
import { parseHostname } from "../router";

describe("parseHostname (v1.0: {hash}.mirror.example.com)", () => {
  it("16 位 hex hash 应正确解析", () => {
    const hash = parseHostname("a1b2c3d4e5f6a7b8.mirror.example.com");
    expect(hash).toBe("a1b2c3d4e5f6a7b8");
  });

  it("另一个合法 hash", () => {
    expect(parseHostname("deadbeef01234567.mirror.example.com")).toBe("deadbeef01234567");
    expect(parseHostname("cafe1234cafe1234.mirror.example.com")).toBe("cafe1234cafe1234");
  });

  // =========================================
  // 无效格式
  // =========================================

  it("裸域应返回 null（Web 前端）", () => {
    expect(parseHostname("mirror.example.com")).toBeNull();
  });

  it("完全不相关的域名应返回 null", () => {
    expect(parseHostname("example.com")).toBeNull();
    expect(parseHostname("docker.com")).toBeNull();
    expect(parseHostname("example.com")).toBeNull();
  });

  it("空字符串应返回 null", () => {
    expect(parseHostname("")).toBeNull();
  });

  it("非 hex 字符应返回 null", () => {
    expect(parseHostname("xyz1234567890abcd.mirror.example.com")).toBeNull();
  });

  it("hash 长度不是 16 位应返回 null", () => {
    expect(parseHostname("abc123.mirror.example.com")).toBeNull();
    expect(parseHostname("a1b2c3d4e5f6a7b8e9.mirror.example.com")).toBeNull();
  });

  it("包含子域点的格式应返回 null", () => {
    expect(parseHostname("a1b2c3.d4e5f6.mirror.example.com")).toBeNull();
  });

  it("旧格式 {hash}-{type} 应返回 null（v3 格式不再支持）", () => {
    expect(parseHostname("a1b2c3d4e5f6a7b8-docker.mirror.example.com")).toBeNull();
    expect(parseHostname("deadbeef-github.mirror.example.com")).toBeNull();
    expect(parseHostname("cafe1234-hf.mirror.example.com")).toBeNull();
  });

  it("hash 包含大写字母（不合法，应为 hex 小写）", () => {
    expect(parseHostname("A1B2C3D4E5F6A7B8.mirror.example.com")).toBeNull();
  });
});
