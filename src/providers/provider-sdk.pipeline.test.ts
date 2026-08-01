// ============================================================================
// src/providers/provider-sdk.pipeline.test.ts — 管线 Hook 单元测试（SDK v2 §5.3）
// ============================================================================
// 覆盖：代理管线（路由表匹配 / hooks / 异常降级）、搜索管线（分页模式）。

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProxyConfig } from "../shared/types";
import { ProviderDefinition } from "./_base";
import { getProvider } from "./registry";
import { renderDocs } from "./docs-manager";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** 测试专用：onBuildRequest 抛错，验证异常降级 */
class BoomProvider extends ProviderDefinition {
  readonly id = "boom-test";
  readonly upstream = "https://example.com";
  readonly authMode = "none" as const;
  readonly meta = {
    id: "boom-test", name: "Boom", description: "test",
    searchEnabled: false, searchLabel: "", searchHint: "",
    setupComponent: "", setupFields: [], enabled: true,
  };
  readonly proxy: ProxyConfig = {
    hooks: {
      onBuildRequest: async () => {
        throw new Error("boom");
      },
    },
  };
  defineResultMapping() {
    return { itemsPath: "x", totalPath: "x", fields: { title: "x", description: "x" } };
  }
  defineResultCard() {
    return {
      titleTemplate: "{title}", badges: [], descriptionShow: false,
      stats: [], quickCommands: [], detailLink: "/detail?type=boom-test&target={id}",
    };
  }
  defineDetail() {
    return { infoEndpoint: "https://example.com/x", infoMapping: { title: "x", description: "x" }, tabs: [] };
  }
  defineSetupGuide() {
    return { summary: "s", quickCommand: "c", sections: [] };
  }
}

describe("proxy pipeline (SDK v2)", () => {
  it("github: 路由表匹配到 raw.githubusercontent.com 并注入 Accept 头", async () => {
    const github = getProvider("github")!;
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://abc123.mirror.example.com/raw/user/repo/file.txt");
    const res = await github.handleProxy(req, {
      userId: "u", providerType: "github", pat: null, patUsername: null,
    });

    expect(res.status).toBe(200);
    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toMatch(/^https:\/\/raw\.githubusercontent\.com\/raw\/user\/repo\/file\.txt/);
    const headers = (call[1] as RequestInit).headers as Headers;
    expect(headers.get("Accept")).toBe("application/vnd.github.v3+json");
  });

  it("github: LFS 路径注入 git-lfs Accept", async () => {
    const github = getProvider("github")!;
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://abc123.mirror.example.com/user/repo.git/info/lfs");
    await github.handleProxy(req, {
      userId: "u", providerType: "github", pat: null, patUsername: null,
    });
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(headers.get("Accept")).toBe("application/vnd.git-lfs+json");
  });

  it("docker: 透传 Host 头，无 PAT 时不注入 Authorization", async () => {
    const docker = getProvider("docker")!;
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://abc123.mirror.example.com/v2/library/nginx/manifests/latest", {
      headers: { "User-Agent": "docker/27.0.0" },
    });
    await docker.handleProxy(req, {
      userId: "u", providerType: "docker", pat: null, patUsername: null,
    });
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(headers.get("Host")).toBe("registry-1.docker.io");
    expect(headers.get("Authorization")).toBeNull();
  });

  it("hook 抛错应降级 502（异常降级不击穿管线）", async () => {
    const boom = new BoomProvider();
    const req = new Request("https://abc123.mirror.example.com/anything");
    const res = await boom.handleProxy(req, {
      userId: "u", providerType: "boom-test", pat: null, patUsername: null,
    });
    expect(res.status).toBe(502);
  });
});

describe("search pipeline (SDK v2)", () => {  it("npm: offset 分页参数拼接（text/size/from）", async () => {
    const npm = getProvider("npm")!;
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({
        objects: [{
          package: {
            name: "react", version: "19", description: "d",
            links: { npm: "https://npmjs.org/react" },
            publisher: { username: "u" }, downloads: 1,
          },
        }],
        total: 100,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await npm.doSearch("react", 3, 25);
    expect(res).not.toBeNull();
    const call = String(fetchMock.mock.calls[0][0]);
    expect(call).toContain("text=react");
    expect(call).toContain("size=25");
    expect(call).toContain("from=50");
    expect(res!.results.length).toBe(1);
    expect(res!.results[0].title).toBe("react");
  });

  it("gomod: pagination=none 时 page 恒 1", async () => {
    const gomod = getProvider("gomod")!;
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({
        items: [{
          modulePath: "github.com/gin-gonic/gin", synopsis: "s",
          version: "v1.9.0", packagePath: "github.com/gin-gonic/gin",
        }],
        total: 1,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await gomod.doSearch("gin", 5, 10);
    expect(res!.page).toBe(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("limit=10");
  });
});

describe("validateContract SSRF 增强（SDK v2 §5.7）", () => {
  it("代理路由 host 为内网 IP 应报违规", () => {
    const evil = new BoomProvider();
    // 覆写 upstream 为内网 IP
    (evil as { upstream: string }).upstream = "http://10.0.0.1";
    const issues = evil.validateContract();
    expect(issues.some((m) => m.includes("internal/IP") || m.includes("https"))).toBe(true);
  });

  it("真实 Provider 全部通过 SSRF 校验（https + 非内网）", () => {
    for (const p of [getProvider("github")!, getProvider("docker")!, getProvider("npm")!]) {
      const issues = p.validateContract();
      expect(issues).toEqual([]);
    }
  });
});

describe("docs-manager 自动派生（SDK v2 §5.5）", () => {
  it("有 routes 的源：端点表渲染镜像域 URL", () => {
    const github = getProvider("github")!;
    const rendered = renderDocs(github, { domain: "abc.mirror.example.com" });
    const ep = rendered.autoSections.find((s) => s.title === "代理端点")!;
    expect(ep.markdown).toContain("https://abc.mirror.example.com/raw/");
    expect(ep.markdown).toContain("https://raw.githubusercontent.com");
    expect(rendered.autoSections.some((s) => s.title === "搜索 API")).toBe(true);
    expect(rendered.autoSections.some((s) => s.title === "凭据类型")).toBe(true);
  });

  it("无 routes 的源：端点表显示默认透传行而非空表", () => {
    const npm = getProvider("npm")!;
    const rendered = renderDocs(npm, { domain: "abc.mirror.example.com" });
    const ep = rendered.autoSections.find((s) => s.title === "代理端点")!;
    expect(ep.markdown).toContain("默认（全部路径）");
    expect(ep.markdown).toContain("https://abc.mirror.example.com/");
    expect(ep.markdown).toContain(npm.upstream);
  });

  it("quickStart 命令替换 {domain}/{hash} 占位符", () => {
    const npm = getProvider("npm")!;
    const rendered = renderDocs(npm, { domain: "abc.mirror.example.com", hash: "abc123" });
    expect(rendered.quickStart.command).not.toContain("{domain}");
    expect(rendered.quickStart.command).not.toContain("{hash}");
  });
});
