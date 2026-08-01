// ============================================================================
// inline-markdown-images.test.ts — markdown 图片内嵌 data URL 单元测试
// ============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { inlineMarkdownImages } from "./inline-markdown-images";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

/** 构造 image/png 响应（内容 1px PNG 字节） */
function pngResponse(bytes = 42): Response {
  return new Response(new Uint8Array(bytes).buffer, {
    status: 200,
    headers: { "Content-Type": "image/png" },
  });
}

describe("inlineMarkdownImages", () => {
  it("相对路径图片内嵌为 data URL（markdown 语法）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pngResponse(4)));

    const out = await inlineMarkdownImages(
      "![logo](./images/logo.png)",
      "https://raw.githubusercontent.com/owner/repo/HEAD/",
    );

    expect(out).toBe("![logo](data:image/png;base64,AAAAAA==)");
  });

  it("HTML <img> 标签 src 内嵌为 data URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pngResponse(4)));

    const out = await inlineMarkdownImages(
      '<img src="assets/badge.png" width="100">',
      "https://raw.githubusercontent.com/owner/repo/HEAD/",
    );

    expect(out).toBe('<img src="data:image/png;base64,AAAAAA==" width="100">');
  });

  it("带 title 的 markdown 图片保留 title", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pngResponse(4)));

    const out = await inlineMarkdownImages(
      '![alt](img.png "title text")',
      "https://huggingface.co/user/model/raw/main/",
    );

    expect(out).toBe('![alt](data:image/png;base64,AAAAAA== "title text")');
  });

  it("跨域图片保持原样（不 fetch）", async () => {
    const fetchMock = vi.fn(async () => pngResponse(4));
    vi.stubGlobal("fetch", fetchMock);

    const out = await inlineMarkdownImages(
      "![badge](https://img.shields.io/badge/x-y)",
      "https://raw.githubusercontent.com/owner/repo/HEAD/",
    );

    expect(out).toBe("![badge](https://img.shields.io/badge/x-y)");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("非 https 图片保持原样", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pngResponse(4)));

    const out = await inlineMarkdownImages(
      "![x](http://raw.githubusercontent.com/owner/repo/HEAD/a.png)",
      "https://raw.githubusercontent.com/owner/repo/HEAD/",
    );

    expect(out).toContain("http://raw.githubusercontent.com");
  });

  it("非 raster content-type 保持原样", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("text", { status: 200, headers: { "Content-Type": "text/plain" } })));

    const out = await inlineMarkdownImages(
      "![x](a.txt)",
      "https://raw.githubusercontent.com/owner/repo/HEAD/",
    );

    expect(out).toBe("![x](a.txt)");
  });

  it("svg 保持原样（拒绝 XSS 面）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("<svg/>", { status: 200, headers: { "Content-Type": "image/svg+xml" } })));

    const out = await inlineMarkdownImages(
      "![x](a.svg)",
      "https://raw.githubusercontent.com/owner/repo/HEAD/",
    );

    expect(out).toBe("![x](a.svg)");
  });

  it("超限图片保持原样", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pngResponse(1024 * 1024 + 1)));

    const out = await inlineMarkdownImages(
      "![x](big.png)",
      "https://raw.githubusercontent.com/owner/repo/HEAD/",
    );

    expect(out).toBe("![x](big.png)");
  });

  it("最多内嵌 8 张，其余保持原样", async () => {
    const fetchMock = vi.fn(async () => pngResponse(4));
    vi.stubGlobal("fetch", fetchMock);

    const md = Array.from({ length: 10 }, (_, i) => `![img${i}](f${i}.png)`).join("\n");
    const out = await inlineMarkdownImages(md, "https://raw.githubusercontent.com/owner/repo/HEAD/");

    expect(fetchMock).toHaveBeenCalledTimes(8);
    const inlined = (out.match(/data:image\/png/g) ?? []).length;
    expect(inlined).toBe(8);
    expect(out).toContain("f8.png");
    expect(out).toContain("f9.png");
  });

  it("无 docBase 原样返回", async () => {
    const fetchMock = vi.fn(async () => pngResponse(4));
    vi.stubGlobal("fetch", fetchMock);

    const md = "![x](./a.png)";
    expect(await inlineMarkdownImages(md)).toBe(md);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("同一 src 只 fetch 一次（去重）", async () => {
    const fetchMock = vi.fn(async () => pngResponse(4));
    vi.stubGlobal("fetch", fetchMock);

    const md = "![a](img.png)\n![b](img.png)";
    const out = await inlineMarkdownImages(md, "https://raw.githubusercontent.com/owner/repo/HEAD/");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.match(/data:image\/png/g)?.length).toBe(2);
  });
});
