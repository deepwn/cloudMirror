// ============================================================================
// src/providers/utils/inline-markdown-images.ts — markdown 图片内嵌 data URL
// ============================================================================
// 后端在 getDetail() 获取 markdown 内容后，将其中图片引用解析并内嵌为 data URL，
// 前端直接渲染，避免：跨域加载、相对路径丢失、单开媒体代理接口。
//
// 安全边界（杜绝滥用，无需内置白名单）：
//   - 仅处理 https，且 host 必须与 docBase 同域（图片请求只发往 provider 声明的上游域）
//   - 仅 raster 图片（png/jpeg/gif/webp/avif/bmp），拒绝 svg（XSS 面）
//   - 单图 ≤ 1MB，最多内嵌 8 张，并发 4
//   - 跨域/超限/非图片：保持原样（前端 img 直接加载，浏览器允许跨域图片）
// ============================================================================

const MAX_IMAGE_BYTES = 1024 * 1024; // 单图字节上限 1MB
const MAX_IMAGES = 8;                // 最多内嵌张数
const CONCURRENCY = 4;               // fetch 并发

/** 允许的 raster 图片类型（拒绝 svg：可嵌入脚本，XSS 面） */
const RASTER_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
]);

/** ArrayBuffer → base64（Worker 环境 btoa 需逐 chunk 转 Latin1 字符串） */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** 解析图片 src → 绝对 URL。相对路径基于 docBase；非 https / 跨域返回 null。 */
function resolveImageUrl(src: string, docBase: URL): URL | null {
  try {
    const u = new URL(src, docBase);
    if (u.protocol !== "https:") return null;
    // 同域校验：图片请求只允许发往 docBase 所在域（SSRF 防护，复用 provider 声明）
    if (u.hostname !== docBase.hostname) return null;
    return u;
  } catch {
    return null;
  }
}

/** fetch 图片 → data URL；失败/非 raster/超限返回 null */
async function fetchAsDataUrl(abs: URL): Promise<string | null> {
  try {
    const res = await fetch(abs.toString(), {
      headers: { "User-Agent": "CloudMirror/4.0" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!RASTER_TYPES.has(ct)) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_BYTES) return null;
    return `data:${ct};base64,${arrayBufferToBase64(buf)}`;
  } catch {
    return null;
  }
}

/**
 * 将 markdown 中的图片引用内嵌为 data URL。
 * 支持 markdown 语法 `![alt](src "title")` 与 HTML `<img src="...">`。
 * 无 docBase / docBase 非法：原样返回。
 */
export async function inlineMarkdownImages(markdown: string, docBase?: string): Promise<string> {
  if (!markdown || !docBase) return markdown;

  let baseUrl: URL;
  try {
    baseUrl = new URL(docBase);
  } catch {
    return markdown;
  }
  if (baseUrl.protocol !== "https:") return markdown;

  // 1. 收集全部图片 src（markdown + HTML），去重
  const srcs: string[] = [];
  markdown.replace(/!\[[^\]]*\]\(([^)\s]+)/g, (_full, src: string) => {
    srcs.push(src);
    return "";
  });
  markdown.replace(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi, (_full, src: string) => {
    srcs.push(src);
    return "";
  });
  const unique = [...new Set(srcs)].slice(0, MAX_IMAGES);

  // 2. 分批并发 fetch → data URL（去重缓存）
  const results = new Map<string, string>();
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const batch = unique.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (src) => {
        const abs = resolveImageUrl(src, baseUrl);
        if (!abs) {
          results.set(src, src);
          return;
        }
        const dataUrl = await fetchAsDataUrl(abs);
        results.set(src, dataUrl ?? src);
      }),
    );
  }

  // 3. 同步替换（data URL 不含空格/括号，无需转义；保留可选 title）
  let out = markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(\s+["'][^"']*["'])?\)/g,
    (_full, alt: string, src: string, title?: string) => {
      const r = results.get(src);
      return r === undefined || r === src ? _full : `![${alt}](${r}${title ?? ""})`;
    },
  );
  out = out.replace(
    /<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>/gi,
    (_full, pre: string, src: string, post: string) => {
      const r = results.get(src);
      return r === undefined || r === src ? _full : `<img${pre}src="${r}"${post}>`;
    },
  );
  return out;
}
