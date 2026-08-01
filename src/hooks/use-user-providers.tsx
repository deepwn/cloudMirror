// ============================================================================
// src/hooks/use-user-providers.tsx — 用户 Provider 哈希上下文
// ============================================================================
// 为 SearchResultCard / SearchResults 等组件提供真实的用户专属子域 hash 与平台域名，
// 替代硬编码的 {hash} 占位符。平台域名来自 /site-info（可被部署者通过 APP_DOMAIN 配置）。
// ============================================================================

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import * as api from "../lib/api";

/** 未配置时的平台域名占位（site-info 返回前使用） */
const DEFAULT_DOMAIN = "mirror.example.com";

interface UserProviderEntry {
  provider: string;
  hash: string;
  enabled: number;
}

interface UserProvidersState {
  /** provider type → hash */
  hashes: Record<string, string>;
  /** 平台域名（子域代理后缀） */
  domain: string;
  loading: boolean;
}

const UserProvidersContext = createContext<UserProvidersState>({
  hashes: {},
  domain: DEFAULT_DOMAIN,
  loading: true,
});

export function UserProvidersProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UserProvidersState>({
    hashes: {},
    domain: DEFAULT_DOMAIN,
    loading: true,
  });

  const loadProviders = useCallback(() => {
    const token = localStorage.getItem("cloudmirror_token");
    if (!token) {
      setState({ hashes: {}, domain: DEFAULT_DOMAIN, loading: false });
      return;
    }

    // 并行获取平台域名（site-info 无需鉴权）与用户 provider 哈希
    Promise.all([
      api.site.info(),
      api.request<{ success: boolean; data: UserProviderEntry[] }>("/providers"),
    ])
      .then(([siteInfo, res]) => {
        const hashes: Record<string, string> = {};
        for (const up of res.data) {
          if (up.hash) hashes[up.provider] = up.hash;
        }
        setState({ hashes, domain: siteInfo.domain || DEFAULT_DOMAIN, loading: false });
      })
      .catch(() => {
        setState({ hashes: {}, domain: DEFAULT_DOMAIN, loading: false });
      });
  }, []);

  useEffect(() => {
    loadProviders();

    // 监听登录/登出事件，重新拉取 hash
    const onAuthChange = () => loadProviders();
    window.addEventListener("authchange", onAuthChange);
    return () => window.removeEventListener("authchange", onAuthChange);
  }, [loadProviders]);

  return (
    <UserProvidersContext.Provider value={state}>
      {children}
    </UserProvidersContext.Provider>
  );
}

export function useUserProviderHash(): {
  /** 获取指定 provider 的用户 hash，无值返回占位符 "{hash}" */
  getHash: (providerId: string) => string;
  /** 获取指定 provider 的完整子域名，无值返回 "{hash}.{domain}" 占位符 */
  getDomain: (providerId: string) => string;
  /** 平台域名（子域代理后缀） */
  domain: string;
} {
  const { hashes, domain } = useContext(UserProvidersContext);

  const getHash = useCallback(
    (providerId: string) => {
      return hashes[providerId] || "{hash}";
    },
    [hashes],
  );

  const getDomain = useCallback(
    (providerId: string) => {
      const h = hashes[providerId];
      return h ? `${h}.${domain}` : `{hash}.${domain}`;
    },
    [hashes, domain],
  );

  return { getHash, getDomain, domain };
}
