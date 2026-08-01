// ============================================================================
// src/providers/utils/base64.ts — Base64 内容解码工具
// 供 ProviderDefinition.getDetail / dart README 抓取等共用。
// ============================================================================

/**
 * 将 GitHub 风格 base64 内容（含换行）解码为 UTF-8 文本。
 * 使用 TextDecoder 正确处理 UTF-8；解码失败返回 null。
 */
export function decodeBase64Content(content: string): string | null {
  try {
    const cleaned = String(content).replace(/\s/g, "");
    const rawBytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(rawBytes);
  } catch {
    return null;
  }
}
