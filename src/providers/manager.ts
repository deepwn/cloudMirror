// ============================================================================
// src/providers/manager.ts — ProviderManager 注册管理器（SDK v2）
// ============================================================================
// 设计依据: docs/architecture.md §3
// - register(): 注册 Provider 实例或类（惰性实例化），链式调用
// - use():      注册插件（provider 插件 / 平台级 middleware）
// - onRegister(): 注册监听（工具链 / docs / 白名单派生挂载点）
// - validate():  全量契约校验（把 baseline 测试内建到运行时）

import type { ProviderDefinition } from "./_base";
import type { ProviderMeta } from "../shared/types";

/** 注册入参：Provider 实例，或 Provider 类（惰性实例化） */
export type ProviderInput = ProviderDefinition | (new () => ProviderDefinition);

/** 插件对象：install 内可 register Provider 或挂 onRegister 注入横切逻辑 */
export type ProviderPlugin = {
  install(m: ProviderManager, opts?: unknown): void;
};

export class ProviderManager {
  private providers = new Map<string, ProviderDefinition>();
  private listeners = new Set<(p: ProviderDefinition) => void>();

  /** 注册 Provider（实例或类）。返回 this 支持链式。 */
  register(input: ProviderInput): this {
    const def = this.normalize(input);
    if (this.providers.has(def.id)) {
      throw new Error(`[ProviderManager] duplicate provider id: ${def.id}`);
    }
    // 注册期契约校验（warn 级）：尽早暴露声明缺陷，不阻断启动。
    // error 级全量校验见 validate()（测试/CI 断言）。
    try {
      const issues = def.validateContract();
      if (issues.length) {
        console.warn(`[ProviderManager] provider "${def.id}" contract issues:\n  - ${issues.join("\n  - ")}`);
      }
    } catch (err) {
      console.warn(`[ProviderManager] provider "${def.id}" validateContract threw:`, (err as Error).message);
    }
    this.providers.set(def.id, def);
    this.listeners.forEach((fn) => fn(def));
    return this;
  }

  /** 插件注册：install 内注册一个或多个 Provider，或挂 onRegister 横切逻辑。 */
  use(plugin: ProviderPlugin, opts?: unknown): this {
    plugin.install(this, opts);
    return this;
  }

  /** 按 id 获取 Provider 实例 */
  get(id: string): ProviderDefinition | undefined {
    return this.providers.get(id);
  }

  /** 全部 Provider（注册顺序） */
  all(): ProviderDefinition[] {
    return [...this.providers.values()];
  }

  /** 启用搜索的 Provider */
  searchable(): ProviderDefinition[] {
    return this.all().filter((p) => p.meta.searchEnabled);
  }

  /** 全部 meta（site-info 等消费方） */
  metas(): ProviderMeta[] {
    return this.all().map((p) => p.meta);
  }

  /** 注册监听：docs / 白名单派生等挂载点。返回退订函数。 */
  onRegister(fn: (p: ProviderDefinition) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** 全量契约校验：返回违规清单（空数组 = 通过）。测试与运行时同源。 */
  validate(): string[] {
    const issues: string[] = [];
    const seen = new Set<string>();
    for (const p of this.all()) {
      if (seen.has(p.id)) issues.push(`duplicate provider id: ${p.id}`);
      seen.add(p.id);
      issues.push(...p.validateContract().map((m) => `[${p.id}] ${m}`));
    }
    return issues;
  }

  private normalize(input: ProviderInput): ProviderDefinition {
    if (typeof input === "function") {
      return new (input as new () => ProviderDefinition)();
    }
    return input;
  }
}

/** 模块级单例：registry.ts 收敛为注册链 */
export const manager = new ProviderManager();
