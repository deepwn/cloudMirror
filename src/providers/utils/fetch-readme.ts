// ============================================================================
// src/providers/utils/fetch-readme.ts — 上游仓库 README 抓取工具
// 支持 GitHub / GitLab 两种常见托管，供 getDetail 覆写（如 dart）复用。
// 返回 README 内容 + docBase（README 所在目录的 raw base URL，供相对图片内嵌）。
// ============================================================================

import { decodeBase64Content } from "./base64";

/** 上游仓库 README 抓取结果 */
export interface RepositoryReadmeResult {
  /** README 内容（markdown） */
  content: string;
  /**
   * README 所在目录的 raw base URL（相对资源解析基准，供前端 DetailTabData.baseUrl）。
   * GitHub: https://raw.githubusercontent.com/{owner}/{repo}/HEAD/
   * GitLab: https://gitlab.com/{group}/{repo}/-/raw/HEAD/
   */
  docBase: string;
}

/**
 * 从 repository 字段解析上游 Git 仓库，返回 README 内容与 docBase。
 * 支持 GitHub / GitLab。解析失败或仓库不可达返回 null。
 */
export async function fetchRepositoryReadme(
  repoUrl: string,
): Promise<RepositoryReadmeResult | null> {
  if (!repoUrl) return null;

  // GitHub: https://github.com/{owner}/{repo}/... 或 https://github.com/{owner}/{repo}
  const ghMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/#?]+)/);
  if (ghMatch) {
    const [, owner, repo] = ghMatch;
    const readmeEp = `https://api.github.com/repos/${owner}/${repo}/readme`;
    try {
      const res = await fetch(readmeEp, {
        headers: { "User-Agent": "CloudMirror/4.0", Accept: "application/vnd.github.v3+json" },
      });
      if (res.ok) {
        const data = (await res.json()) as { content?: string; encoding?: string };
        if (data.content && data.encoding === "base64") {
          const decoded = decodeBase64Content(data.content);
          if (decoded !== null) {
            return {
              content: decoded,
              docBase: `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/`,
            };
          }
        }
      }
    } catch {
      /* github readme failed */
    }
  }

  // GitLab: https://gitlab.com/{group}/{repo}
  const glMatch = repoUrl.match(/gitlab\.com\/([^/]+)\/([^/#?]+)/);
  if (glMatch) {
    const [, group, repo] = glMatch;
    const project = encodeURIComponent(`${group}/${repo}`);
    const readmeEp = `https://gitlab.com/api/v4/projects/${project}/repository/files/README.md/raw?ref=HEAD`;
    try {
      const res = await fetch(readmeEp);
      if (res.ok) {
        return {
          content: await res.text(),
          docBase: `https://gitlab.com/${group}/${repo}/-/raw/HEAD/`,
        };
      }
    } catch {
      /* gitlab readme failed */
    }
  }

  return null;
}
