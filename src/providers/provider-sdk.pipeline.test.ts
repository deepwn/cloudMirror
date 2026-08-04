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
    id: "boom-test",
    name: "Boom",
    description: "test",
    searchEnabled: false,
    searchLabel: "",
    searchHint: "",
    setupComponent: "",
    setupFields: [],
    enabled: true,
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
      titleTemplate: "{title}",
      badges: [],
      descriptionShow: false,
      stats: [],
      quickCommands: [],
      detailLink: "/detail?type=boom-test&target={id}",
    };
  }
  defineDetail() {
    return {
      infoEndpoint: "https://example.com/x",
      infoMapping: { title: "x", description: "x" },
      tabs: [],
    };
  }
  defineSetupGuide() {
    return { summary: "s", quickCommand: "c", sections: [] };
  }
}

describe("proxy pipeline (SDK v2)", () => {
  it("github: 路由表匹配到 raw.githubusercontent.com 并注入 Accept 头", async () => {
    const github = getProvider("github")!;
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response("ok", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://abc123.mirror.example.com/raw/user/repo/file.txt");
    const res = await github.handleProxy(req, {
      userId: "u",
      providerType: "github",
      pat: null,
      patUsername: null,
    });

    expect(res.status).toBe(200);
    const call = fetchMock.mock.calls[0];
    // stripPrefix: /raw/ 剥离后转发到 raw.githubusercontent.com 根路径
    expect(String(call[0])).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/user\/repo\/file\.txt/,
    );
    const headers = (call[1] as RequestInit).headers as Headers;
    expect(headers.get("Accept")).toBe("application/vnd.github.v3+json");
  });

  it("github: /api/ 路由剥离前缀转发到 api.github.com", async () => {
    const github = getProvider("github")!;
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response("ok", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request(
      "https://abc123.mirror.example.com/api/repos/user/repo/releases/latest",
    );
    await github.handleProxy(req, {
      userId: "u",
      providerType: "github",
      pat: null,
      patUsername: null,
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.github.com/repos/user/repo/releases/latest",
    );
  });

  it("github: LFS 路径注入 git-lfs Accept", async () => {
    const github = getProvider("github")!;
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response("ok", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://abc123.mirror.example.com/user/repo.git/info/lfs");
    await github.handleProxy(req, {
      userId: "u",
      providerType: "github",
      pat: null,
      patUsername: null,
    });
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(headers.get("Accept")).toBe("application/vnd.git-lfs+json");
  });

  it("docker: 透传 Host 头，无 PAT 时不注入 Authorization", async () => {
    const docker = getProvider("docker")!;
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response("ok", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://abc123.mirror.example.com/v2/library/nginx/manifests/latest", {
      headers: { "User-Agent": "docker/27.0.0" },
    });
    await docker.handleProxy(req, {
      userId: "u",
      providerType: "docker",
      pat: null,
      patUsername: null,
    });
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(headers.get("Host")).toBe("registry-1.docker.io");
    expect(headers.get("Authorization")).toBeNull();
  });

  it("docker: /v2/ 单段镜像名补全 library/ 并用 PAT 交换 Bearer token", async () => {
    const docker = getProvider("docker")!;
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      if (String(input).startsWith("https://auth.docker.io/token")) {
        return jsonResponse({ token: "exchanged-token" });
      }
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://abc123.mirror.example.com/v2/nginx/manifests/latest", {
      headers: { "User-Agent": "docker/27.0.0" },
    });
    await docker.handleProxy(req, {
      userId: "u",
      providerType: "docker",
      pat: "dckr_pat_xxx",
      patUsername: "evil7",
    });

    // 第 1 次 fetch = token 交换：Basic (username:PAT) + offline_token
    const tokenUrl = String(fetchMock.mock.calls[0][0]);
    expect(tokenUrl).toContain("https://auth.docker.io/token?");
    expect(tokenUrl).toContain("service=registry.docker.io");
    expect(decodeURIComponent(tokenUrl)).toContain("scope=repository:library/nginx:pull");
    expect(tokenUrl).toContain("offline_token=true");
    const tokenHeaders = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(tokenHeaders.Authorization).toBe(`Basic ${btoa("evil7:dckr_pat_xxx")}`);

    // 第 2 次 fetch = registry：target 已补全 library/ 且注入交换后的 Bearer
    const registryUrl = String(fetchMock.mock.calls[1][0]);
    expect(registryUrl).toBe("https://registry-1.docker.io/v2/library/nginx/manifests/latest");
    const regHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Headers;
    expect(regHeaders.get("Authorization")).toBe("Bearer exchanged-token");
    expect(regHeaders.get("Host")).toBe("registry-1.docker.io");
  });

  it("docker: 401 响应重写 WWW-Authenticate realm 指向 mirror 并带 X-Cf-Debug-Auth", async () => {
    const docker = getProvider("docker")!;
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ errors: [] }), {
          status: 401,
          headers: {
            "WWW-Authenticate":
              'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/nginx:pull"',
          },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://abc123.mirror.example.com/v2/", {
      headers: { "User-Agent": "docker/27.0.0" },
    });
    const res = await docker.handleProxy(req, {
      userId: "u",
      providerType: "docker",
      pat: null,
      patUsername: null,
    });

    expect(res.status).toBe(401);
    const wa = res.headers.get("WWW-Authenticate") ?? "";
    expect(wa).toContain('realm="https://abc123.mirror.example.com/token"');
    expect(wa).not.toContain("auth.docker.io");
    // 诊断头：pat=no（无 PAT），client=none（客户端未带 token）
    const dbg = res.headers.get("X-Cf-Debug-Auth") ?? "";
    expect(dbg).toContain("pat=no");
    expect(dbg).toContain("final=none");
  });

  it("docker: 401 响应携带 PAT 交换成功诊断（X-Cf-Debug-Auth）", async () => {
    const docker = getProvider("docker")!;
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      if (String(input).startsWith("https://auth.docker.io/token")) {
        return jsonResponse({ token: "exchanged-token" });
      }
      return new Response(JSON.stringify({ errors: [] }), { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://abc123.mirror.example.com/v2/library/nginx/manifests/latest", {
      headers: { "User-Agent": "docker/27.0.0", Authorization: "Bearer client-token" },
    });
    const res = await docker.handleProxy(req, {
      userId: "u",
      providerType: "docker",
      pat: "dckr_pat_xxx",
      patUsername: "evil7",
    });
    expect(res.status).toBe(401);
    const dbg = res.headers.get("X-Cf-Debug-Auth") ?? "";
    expect(dbg).toContain("pat=yes");
    expect(dbg).toContain("client=Bearer"); // client Authorization scheme 是大写 Bearer
    expect(dbg).toContain("auth=exchange");
    expect(dbg).toContain("final=server");
  });

  it("docker: /token 请求透传到 auth.docker.io 并注入 Basic PAT", async () => {
    const docker = getProvider("docker")!;
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({ token: "client-token" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request(
      "https://abc123.mirror.example.com/token?service=registry.docker.io&scope=repository:library/nginx:pull",
      { headers: { "User-Agent": "docker/27.0.0" } },
    );
    await docker.handleProxy(req, {
      userId: "u",
      providerType: "docker",
      pat: "dckr_pat_xxx",
      patUsername: "evil7",
    });

    const target = String(fetchMock.mock.calls[0][0]);
    expect(target).toBe(
      "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/nginx:pull",
    );
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(headers.get("Host")).toBe("auth.docker.io");
    expect(headers.get("Authorization")).toBe(`Basic ${btoa("evil7:dckr_pat_xxx")}`);
  });

  it("docker: /token scope 单段镜像名补全 library/", async () => {
    const docker = getProvider("docker")!;
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({ token: "client-token" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request(
      "https://abc123.mirror.example.com/token?service=registry.docker.io&scope=repository:neo4j:pull",
      { headers: { "User-Agent": "docker/27.0.0" } },
    );
    await docker.handleProxy(req, {
      userId: "u",
      providerType: "docker",
      pat: null,
      patUsername: null,
    });

    const target = String(fetchMock.mock.calls[0][0]);
    expect(decodeURIComponent(target)).toContain("scope=repository:library/neo4j:pull");
  });

  it("docker: token 交换失败时保留客户端 Authorization 作 fallback", async () => {
    const docker = getProvider("docker")!;
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      if (String(input).startsWith("https://auth.docker.io/token")) {
        return new Response("unauthorized", { status: 401 });
      }
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://abc123.mirror.example.com/v2/library/nginx/manifests/latest", {
      headers: { "User-Agent": "docker/27.0.0", Authorization: "Bearer client-token" },
    });
    await docker.handleProxy(req, {
      userId: "u",
      providerType: "docker",
      pat: "bad_pat",
      patUsername: "evil7",
    });
    const regHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Headers;
    expect(regHeaders.get("Authorization")).toBe("Bearer client-token");
  });

  it("hook 抛错应降级 502（异常降级不击穿管线）", async () => {
    const boom = new BoomProvider();
    const req = new Request("https://abc123.mirror.example.com/anything");
    const res = await boom.handleProxy(req, {
      userId: "u",
      providerType: "boom-test",
      pat: null,
      patUsername: null,
    });
    expect(res.status).toBe(502);
  });

  it("cargo: sparse index 转发到 index.crates.io 且重写 download URL", async () => {
    const cargo = getProvider("cargo")!;
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ dl: "https://static.crates.io/crates/serde/serde-1.0.219.crate" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://abc123.mirror.example.com/api/v1/crates/se/rd/serde");
    const res = await cargo.handleProxy(req, {
      userId: "u",
      providerType: "cargo",
      pat: null,
      patUsername: null,
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe("https://index.crates.io/se/rd/serde");
    const body = await res.text();
    expect(body).toContain("https://abc123.mirror.example.com/crates/serde/serde-1.0.219.crate");
    expect(body).not.toContain("https://static.crates.io");
  });

  it("cargo: 文件下载路由转发到 static.crates.io", async () => {
    const cargo = getProvider("cargo")!;
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response("binary", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://abc123.mirror.example.com/crates/serde/serde-1.0.219.crate");
    await cargo.handleProxy(req, {
      userId: "u",
      providerType: "cargo",
      pat: null,
      patUsername: null,
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://static.crates.io/crates/serde/serde-1.0.219.crate",
    );
  });

  it("nuget: /v3/index.json 转发到 api.nuget.org/v3（无双重 /v3）", async () => {
    const nuget = getProvider("nuget")!;
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ resources: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://abc123.mirror.example.com/v3/index.json");
    await nuget.handleProxy(req, {
      userId: "u",
      providerType: "nuget",
      pat: null,
      patUsername: null,
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.nuget.org/v3/index.json");
  });

  it("maven: /maven2 路径转发到 repo1.maven.org（无双重 /maven2）", async () => {
    const maven = getProvider("maven")!;
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response("<project/>", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request(
      "https://abc123.mirror.example.com/maven2/junit/junit/4.13.2/junit-4.13.2.pom",
    );
    await maven.handleProxy(req, {
      userId: "u",
      providerType: "maven",
      pat: null,
      patUsername: null,
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://repo1.maven.org/maven2/junit/junit/4.13.2/junit-4.13.2.pom",
    );
  });

  it("pypi: /simple HTML 重写文件链接到 mirror host", async () => {
    const pypi = getProvider("pypi")!;
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          '<html><a href="https://files.pythonhosted.org/packages/xx/six-1.16.0-py2.py3-none-any.whl">six-1.16.0.whl</a></html>',
          { status: 200, headers: { "Content-Type": "text/html" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://abc123.mirror.example.com/simple/six/");
    const res = await pypi.handleProxy(req, {
      userId: "u",
      providerType: "pypi",
      pat: null,
      patUsername: null,
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://pypi.org/simple/six/");
    const body = await res.text();
    expect(body).toContain(
      "https://abc123.mirror.example.com/packages/xx/six-1.16.0-py2.py3-none-any.whl",
    );
    expect(body).not.toContain("https://files.pythonhosted.org");
  });
});

describe("search pipeline (SDK v2)", () => {
  it("npm: offset 分页参数拼接（text/size/from）", async () => {
    const npm = getProvider("npm")!;
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({
        objects: [
          {
            package: {
              name: "react",
              version: "19",
              description: "d",
              links: { npm: "https://npmjs.org/react" },
              publisher: { username: "u" },
              downloads: 1,
            },
          },
        ],
        total: 100,
      }),
    );
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
        items: [
          {
            modulePath: "github.com/gin-gonic/gin",
            synopsis: "s",
            version: "v1.9.0",
            packagePath: "github.com/gin-gonic/gin",
          },
        ],
        total: 1,
      }),
    );
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
