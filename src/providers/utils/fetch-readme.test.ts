// ============================================================================
// fetch-readme.test.ts — 上游仓库 README 抓取 + docBase 派生 + 图片内嵌
// ============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRepositoryReadme } from "./fetch-readme";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

describe("fetchRepositoryReadme", () => {
  it("GitHub：返回 README 内容与 raw docBase", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        content: Buffer.from("# Hello\n![logo](./assets/a.png)").toString("base64"),
        encoding: "base64",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })));

    const result = await fetchRepositoryReadme("https://github.com/flutter/packages");

    expect(result?.content).toContain("# Hello");
    expect(result?.docBase).toBe("https://raw.githubusercontent.com/flutter/packages/HEAD/");
  });

  it("GitHub：带路径后缀的 repository URL 也能解析", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        content: Buffer.from("readme").toString("base64"),
        encoding: "base64",
      }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const result = await fetchRepositoryReadme("https://github.com/owner/repo/tree/main/packages/foo");

    expect(result?.docBase).toBe("https://raw.githubusercontent.com/owner/repo/HEAD/");
  });

  it("GitLab：返回 README 内容与 /-/raw/HEAD/ docBase", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("# GitLab Readme", { status: 200, headers: { "Content-Type": "text/plain" } })));

    const result = await fetchRepositoryReadme("https://gitlab.com/group/project");

    expect(result?.content).toBe("# GitLab Readme");
    expect(result?.docBase).toBe("https://gitlab.com/group/project/-/raw/HEAD/");
  });

  it("不支持的主机返回 null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const result = await fetchRepositoryReadme("https://bitbucket.org/user/repo");
    expect(result).toBeNull();
  });

  it("GitHub 请求失败返回 null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const result = await fetchRepositoryReadme("https://github.com/owner/repo");
    expect(result).toBeNull();
  });

  it("空 repository 返回 null", async () => {
    const result = await fetchRepositoryReadme("");
    expect(result).toBeNull();
  });
});
