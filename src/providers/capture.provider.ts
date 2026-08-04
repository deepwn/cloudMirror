// ============================================================================
// src/providers/capture.provider.ts — Capture Provider（流量录制/回显）
// ============================================================================
// 用途：构造未知 CLI 流程的 Provider 时，把 CLI 指向本 provider 的专属子域，
//       所有请求被完整录制（method/path/headers/body/UA/IP）并返回合成响应，
//       在 UI「调试工具 → 流量录制」查看请求序列并导出。
//
// 模式：
//   echo      → 200 + 回显请求信息（method/path/headers）——用于 Web API 类 CLI
//   challenge → 401 + WWW-Authenticate: Bearer realm="{mirror}/token",service="{host}"
//               （OCI/Registry 类 CLI 收到后自动发起 token 请求，全流程被录制）
//   custom    → 自定义 status/headers/body
//
// 说明：本 provider 在 worker/index.ts 中被特判（capture 子域 → handleCaptureRequest），
//       不经过 _base 管线；此处 ProviderDefinition 仅用于 meta/注册/子域/启用复用。
// ============================================================================

import { ProviderDefinition } from "./_base";
import type {
  ProviderMeta,
  ProxyConfig,
  ResultMapping,
  ResultCardConfig,
  DetailConfig,
  SetupGuideConfig,
} from "../shared/types";

export class CaptureProvider extends ProviderDefinition {
  readonly id = "capture";
  readonly upstream = "https://example.invalid"; // 不实际转发
  readonly authMode = "none" as const;

  readonly meta: ProviderMeta = {
    id: "capture",
    name: "流量录制",
    label: "Capture",
    icon: { kind: "lucide", name: "Radio" },
    description: "将 CLI 请求完整录制并回显，用于构造/调试未知 Provider 的请求流程",
    searchEnabled: false,
    searchLabel: "",
    searchHint: "把 CLI 的 registry/base-url 指向本 provider 子域，请求将被录制",
    setupComponent: "",
    setupFields: [],
    enabled: true,
  };

  // 不实际转发：全部路径由 worker 层 handleCaptureRequest 处理
  readonly proxy: ProxyConfig = { routes: [] };

  defineResultMapping(): ResultMapping {
    return { itemsPath: "x", totalPath: "x", fields: { title: "x", description: "x" } };
  }

  defineResultCard(): ResultCardConfig {
    return {
      titleTemplate: "{title}",
      badges: [],
      descriptionShow: false,
      stats: [],
      quickCommands: [],
      detailLink: "/detail?type=capture&target={id}",
    };
  }

  defineDetail(): DetailConfig {
    return {
      infoEndpoint: "https://example.invalid/x",
      infoMapping: { title: "x", description: "x" },
      tabs: [],
    };
  }

  defineSetupGuide(): SetupGuideConfig {
    return {
      summary: "把未知 CLI 的 registry/base-url 指向本 provider 子域，所有请求会被录制并回显。",
      quickCommand: "echo '把 CLI 指向 {domain} 即可'",
      sections: [
        {
          title: "使用方法",
          items: [
            {
              label: "CLI 指向",
              value: "把 CLI 的 registry/base-url 设为 https://{domain}",
              mode: "inline",
            },
            {
              label: "查看录制",
              value: "在 调试工具 → 流量录制 中查看请求序列并导出 JSONL",
              mode: "inline",
            },
          ],
        },
      ],
    };
  }
}

export const captureProvider = new CaptureProvider();
