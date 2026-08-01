// ============================================================================
// src/hooks/use-provider.ts — Provider 实例获取 hook
// ============================================================================

import { getProvider, getSearchProviders, getAllProviders } from "../providers/registry";
import type { ProviderDefinition } from "../providers/_base";

/** 根据 id 获取 Provider 实例 */
export function useProvider(id: string): ProviderDefinition | undefined {
  return getProvider(id);
}

/** 获取所有支持搜索的 Provider */
export function useSearchProviders(): ProviderDefinition[] {
  return getSearchProviders();
}

/** 获取所有 Provider */
export function useAllProviders(): ProviderDefinition[] {
  return getAllProviders();
}

// Re-export for non-hook usage
export { getProvider, getSearchProviders, getAllProviders };
