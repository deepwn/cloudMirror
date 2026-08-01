// ============================================================================
// src/shared/utils/json-path.ts — dot-notation / JSONPath 取值工具
// ============================================================================
// 支持:
//   "package.name"              → obj.package.name
//   "package.publisher?.name"   → obj.package?.publisher?.name (optional chaining)
//   "images[0].architecture"    → obj.images[0].architecture
//   ""                          → 返回 undefined
// ============================================================================

/**
 * 使用 dot-notation 从对象中安全取值。
 * 支持 ? (optional chaining) 和 [n] (数组索引)。
 * 路径为空或对象为 null/undefined 时返回 undefined。
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path || obj == null) return undefined;
  // 将 "images[0].architecture" 转为 "images.0.architecture"
  const normalized = path.replace(/\[(\d+)\]/g, ".$1");
  const segments = normalized.split(".");

  let current: unknown = obj;
  for (const seg of segments) {
    if (!seg) continue;
    // optional chaining: "publisher?"
    if (seg.endsWith("?")) {
      const key = seg.slice(0, -1);
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[key];
    } else {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[seg];
    }
  }
  return current;
}
