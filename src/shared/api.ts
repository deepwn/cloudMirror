// ============================================================================
// src/shared/api.ts — 平台 API 命名空间（单一事实源，前后端共享）
// ============================================================================
// SDK v2：平台 API 从 /api/v1 迁移到独立命名空间 /cloudmirror-api/v1，
// 与代理路由表中的上游路径（如 cargo 的 /api/v1/ 前缀）彻底隔离，杜绝语义撞车。
// 详见 docs/architecture.md §1.2。

export const PLATFORM_API_PREFIX = "/cloudmirror-api/v1";

/** 拼接平台 API 完整路径，如 platformApi("/search?type=npm") */
export const platformApi = (path: string): string => `${PLATFORM_API_PREFIX}${path}`;
