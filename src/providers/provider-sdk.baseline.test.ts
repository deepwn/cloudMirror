import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_PROVIDERS, getSearchProviders, manager } from "./registry";
import { interpolateTemplate } from "../shared/utils/template";

const originalFetch = globalThis.fetch;

const expectedDisplayNames: Record<string, string> = {
  docker: "Docker",
  github: "GitHub",
  hf: "Hugging Face",
  npm: "npm",
  pypi: "PyPI",
  cargo: "Rust",
  gomod: "Go",
  maven: "Maven",
  nuget: "NuGet",
  rubygems: "Ruby",
  packagist: "Composer",
  cpan: "Perl",
  dart: "Dart",
  cran: "R",
};

const searchQueryByProvider: Record<string, string> = {
  docker: "nginx",
  github: "react",
  hf: "llama",
  npm: "react",
  pypi: "requests",
  cargo: "serde",
  gomod: "gin",
  maven: "spring-boot",
  nuget: "Newtonsoft",
  rubygems: "rails",
  packagist: "symfony",
  cpan: "Moose",
  dart: "provider",
  cran: "ggplot2",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

describe("provider manager (SDK v2)", () => {
  it("manager.validate 应通过（注册期契约校验内建 baseline）", () => {
    const issues = manager.validate();
    expect(issues).toEqual([]);
  });

  it("register 应拒绝重复 id", () => {
    expect(() => manager.register(ALL_PROVIDERS[0])).toThrow(/duplicate provider id/);
  });

  it("render 聚合契约应完整（RenderContract）", () => {
    for (const p of ALL_PROVIDERS) {
      const r = p.render();
      // 声明式搜索源必须有 itemsPath；自定义 doSearch 源（cran/rubygems）在 doSearch 内已映射，可留空
      if (p.search) expect(r.resultMapping.itemsPath.length).toBeGreaterThan(0);
      expect(r.resultCard.detailLink.length).toBeGreaterThan(0);
      expect(r.detail.infoEndpoint.length).toBeGreaterThan(0);
      expect(r.setupGuide.summary.length).toBeGreaterThan(0);
      expect(r.credentialTypes.length).toBeGreaterThan(0);
    }
  });

  it("validateContract 应校验 https 端点（SSRF 防护）", () => {
    for (const p of ALL_PROVIDERS) {
      expect(p.validateContract()).toEqual([]);
    }
  });

  it("docs 自动派生应可用（DocsManager）", () => {
    for (const p of ALL_PROVIDERS) {
      const docs = p.docs();
      expect(docs.summary.length).toBeGreaterThan(0);
      expect(docs.quickStart.command.length).toBeGreaterThan(0);
    }
  });
});

describe("provider sdk baseline", () => {
  it("所有 provider 元数据应满足基础约束", () => {
    const ids = ALL_PROVIDERS.map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const provider of ALL_PROVIDERS) {
      expect(provider.meta.id).toBe(provider.id);
      expect(provider.meta.name.length).toBeGreaterThan(0);
      expect(provider.displayName).toBe(expectedDisplayNames[provider.id]);
      expect(provider.meta.description.length).toBeGreaterThan(0);
      expect(provider.defineSetupGuide().summary.length).toBeGreaterThan(0);
      expect(provider.defineSetupGuide().quickCommand.length).toBeGreaterThan(0);
      expect(provider.defineSetupGuide().sections.length).toBeGreaterThan(0);

      const detail = provider.defineDetail();
      expect(detail.infoEndpoint.length).toBeGreaterThan(0);
      expect(detail.infoEndpoint.includes("{id}")).toBe(false);
      for (const tab of detail.tabs) {
        expect(tab.id.length).toBeGreaterThan(0);
        expect(tab.label.length).toBeGreaterThan(0);
        expect(tab.dataSource.endpoint.includes("{id}")).toBe(false);
      }
    }
  });

  it("搜索 provider 列表应只返回启用搜索的源", () => {
    const searchProviders = getSearchProviders();
    expect(searchProviders.length).toBe(ALL_PROVIDERS.length);
    expect(searchProviders.every((provider) => provider.meta.searchEnabled)).toBe(true);
  });

  it("模板插值应支持 stats 和嵌套字段", () => {
    const out = interpolateTemplate(
      "npm i {title} --registry {domain} // {stats.downloads} / {raw.owner.login}",
      {
        title: "react",
        domain: "demo.mirror.example.com",
        stats: { downloads: 12345 },
        raw: { owner: { login: "meta" } },
      },
    );

    expect(out).toContain("react");
    expect(out).toContain("demo.mirror.example.com");
    expect(out).toContain("12345");
    expect(out).toContain("meta");
  });

  it.each(getSearchProviders().map((provider) => provider.id))(
    "%s doSearch 应返回标准化结果",
    async (providerId) => {
      stubSearchFetch();
      const provider = ALL_PROVIDERS.find((item) => item.id === providerId);
      expect(provider).toBeDefined();

      const result = await provider!.doSearch(searchQueryByProvider[providerId], 1, 5);
      expect(result).not.toBeNull();
      expect(result!.results.length).toBeGreaterThan(0);
      expect(result!.total).toBeGreaterThan(0);

      for (const item of result!.results) {
        expect(item.providerType).toBe(providerId);
        expect(item.id.length).toBeGreaterThan(0);
        expect(item.title.length).toBeGreaterThan(0);
        expect(item.kind.length).toBeGreaterThan(0);
      }
    },
  );
});

function stubSearchFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url.startsWith("https://index.docker.io/v1/search")) {
        return jsonResponse({
          results: [
            {
              name: "library/nginx",
              description: "High performance web server",
              star_count: 100,
              pull_count: 999999,
              is_official: true,
              is_trusted: false,
            },
          ],
          num_results: 1,
        });
      }

      if (url.startsWith("https://api.github.com/search/repositories")) {
        return jsonResponse({
          items: [
            {
              full_name: "facebook/react",
              description: "UI library",
              stargazers_count: 100,
              forks_count: 20,
              language: "TypeScript",
              clone_url: "https://github.com/facebook/react.git",
              html_url: "https://github.com/facebook/react",
              updated_at: "2026-01-01T00:00:00.000Z",
            },
          ],
          total_count: 1,
        });
      }

      if (url.startsWith("https://huggingface.co/api/models")) {
        return jsonResponse([
          {
            id: "meta-llama/Llama-3.1-8B",
            description: "Large language model",
            author: "meta-llama",
            downloads: 321,
            likes: 98,
            pipeline_tag: "text-generation",
          },
        ]);
      }

      if (url.startsWith("https://huggingface.co/api/datasets")) {
        return jsonResponse([
          {
            id: "rajpurkar/squad",
            description: "Reading comprehension dataset",
            author: "rajpurkar",
            downloads: 210,
            likes: 12,
          },
        ]);
      }

      if (url.startsWith("https://registry.npmjs.org/-/v1/search")) {
        return jsonResponse({
          objects: [
            {
              package: {
                name: "react",
                description: "UI library",
                version: "19.0.0",
                publisher: { username: "meta" },
                links: { npm: "https://www.npmjs.com/package/react" },
              },
            },
          ],
          total: 1,
        });
      }

      if (url === "https://pypi.org/pypi/requests/json") {
        return jsonResponse({
          info: {
            name: "requests",
            version: "2.32.0",
            summary: "HTTP for Humans.",
          },
        });
      }

      if (url.startsWith("https://pypi.org/search/")) {
        return textResponse(`
          <a class="package-snippet">
            <span class="package-snippet__name">requests-cache</span>
            <span class="package-snippet__version">1.2.1</span>
            <p class="package-snippet__description">Persistent cache for requests</p>
          </a>
        `);
      }

      if (url.startsWith("https://crates.io/api/v1/crates")) {
        return jsonResponse({
          crates: [
            {
              id: "serde",
              name: "serde",
              description: "Serialization framework",
              max_stable_version: "1.0.229",
              downloads: 123456,
              recent_downloads: 4567,
            },
          ],
          meta: { total: 1 },
        });
      }

      if (url.startsWith("https://pkg.go.dev/v1beta/search")) {
        return jsonResponse({
          items: [
            {
              packagePath: "github.com/gin-gonic/gin",
              modulePath: "github.com/gin-gonic/gin",
              version: "v1.12.0",
              synopsis: "HTTP web framework",
            },
          ],
          total: 1,
        });
      }

      if (url.startsWith("https://search.maven.org/solrsearch/select")) {
        return jsonResponse({
          response: {
            numFound: 1,
            docs: [
              {
                id: "org.springframework.boot:spring-boot",
                g: "org.springframework.boot",
                a: "spring-boot",
                latestVersion: "3.5.3",
                timestamp: 1750397303000,
                versionCount: 252,
                p: "jar",
                v: "3.5.3",
              },
            ],
          },
        });
      }

      if (url.startsWith("https://azuresearch-usnc.nuget.org/query")) {
        return jsonResponse({
          totalHits: 1,
          data: [
            {
              id: "Newtonsoft.Json",
              version: "13.0.3",
              description: "Json framework",
              authors: ["James Newton-King"],
              projectUrl: "https://www.newtonsoft.com/json",
              totalDownloads: 1000,
            },
          ],
        });
      }

      if (url.startsWith("https://rubygems.org/api/v1/search.json")) {
        return jsonResponse([
          {
            name: "rails",
            version: "8.1.3.1",
            info: "Full-stack web framework",
            downloads: 1000,
            homepage_uri: "https://rubyonrails.org",
          },
        ]);
      }

      if (url.startsWith("https://packagist.org/search.json")) {
        return jsonResponse({
          total: 1,
          results: [
            {
              name: "symfony/console",
              description: "Console component",
              url: "https://packagist.org/packages/symfony/console",
              downloads: 12345,
            },
          ],
        });
      }

      if (url.startsWith("https://fastapi.metacpan.org/v1/release/_search")) {
        return jsonResponse({
          hits: {
            total: 1,
            hits: [
              {
                _source: {
                  distribution: "Moose",
                  abstract: "A postmodern object system for Perl 5",
                  version: "2.4000",
                  author: "ETHER",
                },
              },
            ],
          },
        });
      }

      if (url.startsWith("https://pub.dev/api/search")) {
        return jsonResponse({
          packages: [{ package: "provider" }],
          next: null,
        });
      }

      if (url.startsWith("https://pub.dev/api/packages/provider/score")) {
        return jsonResponse({
          likeCount: 10994,
          downloadCount30Days: 1109128,
        });
      }

      if (url.startsWith("https://pub.dev/api/packages/")) {
        return jsonResponse({
          name: "provider",
          latest: { version: "6.1.2", pubspec: { description: "状态管理", homepage: "https://pub.dev/packages/provider" } },
        });
      }

      if (url.startsWith("https://crandb.r-pkg.org/-/desc")) {
        return jsonResponse({
          ggplot2: { version: "3.5.1", title: "Create Elegant Data Visualisations Using the Grammar of Graphics" },
        });
      }

      throw new Error(`Unexpected fetch URL in baseline test: ${url}`);
    }),
  );
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(data: string, status = 200): Response {
  return new Response(data, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}
