// ============================================================================
// src/providers/utils/fetch-readme.ts — 上游仓库 README 抓取工具
// 支持 GitHub / GitLab 两种常见托管，供 getDetail 覆写（如 dart）复用。
// ============================================================================

import { decodeBase64Content } from "./base64";

/**
 * 从 repository 字段解析上游 Git 仓库，返回 README 内容。
 * 支持 GitHub / GitLab。解析失败或仓库不可达返回 null。
 */
export async function fetchRepositoryReadme(repoUrl: string): Promise<string | null> {
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
        const data = await res.json() as { content?: string; encoding?: string };
        if (data.content && data.encoding === "base64") {
          const decoded = decodeBase64Content(data.content);
          if (decoded !== null) return decoded;
        }
      }
    } catch { /* github readme failed */ }
  }

  // GitLab: https://gitlab.com/{group}/{repo}
  const glMatch = repoUrl.match(/gitlab\.com\/([^/]+)\/([^/#?]+)/);
  if (glMatch) {
    const [, group, repo] = glMatch;
    const project = encodeURIComponent(`${group}/${repo}`);
    const readmeEp = `https://gitlab.com/api/v4/projects/${project}/repository/files/README.md/raw?ref=HEAD`;
    try {
      const res = await fetch(readmeEp);
      if (res.ok) return await res.text();
    } catch { /* gitlab readme failed */ }
  }

  return null;
}
