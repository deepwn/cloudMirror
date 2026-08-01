// ============================================================================
// src/providers/utils/inline-markdown-images.ts — markdown 图片内嵌 data URL
// ============================================================================
// 后端在 getDetail() 获取 markdown 内容后，将其中图片引用解析并内嵌为 data URL，
// 前端直接渲染，避免：跨域加载、相对路径丢失、单开媒体代理接口。
//
// 安全边界（杜绝滥用，无需内置白名单）：
//   - 仅 https，host 不得为内网/IP/localhost（SSRF 防护，复用 validateContract 判定）
//   - 允许跨域（README 常引用 github.com/shields.io 等外部图床）；fetch 后校验
//     最终重定向 URL 的 host 仍非内网
//   - 允许 raster（png/jpeg/gif/webp/avif/bmp）+ svg。svg 内嵌为 data:image/svg+xml
//     置于 <img> 内属于安全图像上下文（脚本不执行，同 GitHub 渲染 svg 徽章）
//   - github.com/.../blob/... 与 /raw/... 链接规范化为 raw.githubusercontent.com
//   - 单图 ≤ 1MB，最多内嵌 8 张，并发 4
//   - 超限/非图片/危险 host：保持原样（前端 img 直接加载，浏览器允许跨域图片）
// ============================================================================

const MAX_IMAGE_BYTES = 1024 * 1024; // 单图字节上限 1MB
const MAX_IMAGES = 8;                // 最多内嵌张数
const CONCURRENCY = 4;               // fetch 并发

/** 允许的图片类型（raster + svg；svg 仅在 <img> 内安全） */
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/svg+xml",
]);

/**
 * SSRF 防护（与 _base.ts validateContract 同规则）：内网/IP 字面量 host 拒绝。
 * 拒绝：IPv6、IPv4 字面量、localhost、10.x / 172.16-31.x / 192.168.x / 127.x / 169.254.x。
 */
function isSuspiciousHostname(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname.includes(":")) return true; // IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true; // IPv4 字面量
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (/^(10|127|169\.254|192\.168)\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  return false;
}

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

/**
 * github.com blob/raw 页面链接 → raw.githubusercontent.com 直接文件 URL。
 * 例: github.com/o/r/blob/main/a.png?raw=true → raw.githubusercontent.com/o/r/main/a.png
 *     github.com/o/r/raw/main/a.png            → raw.githubusercontent.com/o/r/main/a.png
 * 非 github 或无法解析原样返回。
 */
function normalizeGithubUrl(src: string): string {
  const blobMatch = src.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/blob\/([^/#?]+)\/(.+)$/);
  if (blobMatch) {
    const [, owner, repo, branch, path] = blobMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.split("?")[0]}`;
  }
  const rawMatch = src.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/raw\/([^/#?]+)\/(.+)$/);
  if (rawMatch) {
    const [, owner, repo, branch, path] = rawMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.split("?")[0]}`;
  }
  return src;
}

/** 解析图片 src → 绝对 URL（相对基于 docBase）。非法/内网返回 null。 */
function resolveImageUrl(src: string, docBase: URL): URL | null {
  try {
    const u = new URL(src, docBase);
    if (u.protocol !== "https:") return null;
    if (isSuspiciousHostname(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

/** fetch 图片 → data URL；失败/非图片类型/内网重定向/超限返回 null */
async function fetchAsDataUrl(abs: URL): Promise<string | null> {
  try {
    const res = await fetch(abs.toString(), {
      headers: { "User-Agent": "CloudMirror/4.0" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    // 重定向后最终 host 仍须安全（防 302 到内网）；真实 fetch 必有 res.url
    if (res.url) {
      try {
        if (isSuspiciousHostname(new URL(res.url).hostname)) return null;
      } catch { return null; }
    }
    const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(ct)) return null;
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

  // 1. 收集全部图片 src（markdown + HTML），规范化 github 链接，去重
  const srcs: string[] = [];
  markdown.replace(/!\[[^\]]*\]\(([^)\s]+)/g, (_full, src: string) => {
    srcs.push(normalizeGithubUrl(src));
    return "";
  });
  markdown.replace(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi, (_full, src: string) => {
    srcs.push(normalizeGithubUrl(src));
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

  // 3. 同步替换（data URL 不含空格/括号，无需转义；保留可选 title）。
  //    results 的 key 为规范化后的 src（github blob/raw → raw.githubusercontent.com）
  let out = markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(\s+["'][^"']*["'])?\)/g,
    (_full, alt: string, src: string, title?: string) => {
      const key = normalizeGithubUrl(src);
      const r = results.get(key);
      return r === undefined || r === key ? _full : `![${alt}](${r}${title ?? ""})`;
    },
  );
  out = out.replace(
    /<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>/gi,
    (_full, pre: string, src: string, post: string) => {
      const key = normalizeGithubUrl(src);
      const r = results.get(key);
      return r === undefined || r === key ? _full : `<img${pre}src="${r}"${post}>`;
    },
  );
  return out;
}
