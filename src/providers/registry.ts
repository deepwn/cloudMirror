// ============================================================================
// src/providers/registry.ts — Provider 注册（SDK v2: ProviderManager 注册链）
// ============================================================================
// 新增 Provider：import + manager.register(...) 一行即可。
// 注册期由 manager 执行 id 去重与契约校验（validate 内建 baseline）。
// 详情见 docs/architecture.md §2.7

import { manager } from "./manager";
import { dockerProvider } from "./docker.provider";
import { githubProvider } from "./github.provider";
import { huggingfaceProvider } from "./huggingface.provider";
import { npmProvider } from "./npm.provider";
import { pypiProvider } from "./pypi.provider";
import { cargoProvider } from "./cargo.provider";
import { gomodProvider } from "./gomod.provider";
import { mavenProvider } from "./maven.provider";
import { nugetProvider } from "./nuget.provider";
import { rubygemsProvider } from "./rubygems.provider";
import { packagistProvider } from "./packagist.provider";
import { cpanProvider } from "./cpan.provider";
import { dartProvider } from "./dart.provider";
import { cranProvider } from "./cran.provider";

manager
  .register(githubProvider)
  .register(dockerProvider)
  .register(huggingfaceProvider)
  .register(npmProvider)
  .register(pypiProvider)
  .register(cargoProvider)
  .register(gomodProvider)
  .register(mavenProvider)
  .register(nugetProvider)
  .register(rubygemsProvider)
  .register(packagistProvider)
  .register(cpanProvider)
  .register(dartProvider)
  .register(cranProvider);

export { manager };

/** 全部 Provider 实例（注册顺序） */
export const ALL_PROVIDERS = manager.all();

export function getProvider(id: string) {
  return manager.get(id);
}

export function getSearchProviders() {
  return manager.searchable();
}

export function getAllMetas() {
  return manager.metas();
}

export function getAllProviders() {
  return manager.all();
}
