// ============================================================================
// src/providers/huggingface.provider.ts — HuggingFace Provider
// ============================================================================

import { ProviderDefinition } from "./_base";
import type {
  ProviderMeta,
  ProxyConfig,
  ResultMapping,
  ResultCardConfig,
  DetailConfig,
  SetupGuideConfig,
  PopularSearch,
  GenericSearchResponse,
} from "../shared/types";

export class HuggingFaceProvider extends ProviderDefinition {
  readonly id = "hf";
  readonly upstream = "https://huggingface.co";
  readonly authMode = "bearer" as const;

  readonly meta: ProviderMeta = {
    id: "hf",
    name: "Hugging Face",
    label: "Hugging Face",
    icon: { kind: "simple-icons", name: "siHuggingface", colored: true },
    description: "AI 模型与数据集代理加速（Git LFS 协议穿透）",
    searchEnabled: true,
    searchLabel: "搜索模型/数据集...",
    searchHint: "hf download user/model --endpoint https://{hash}.mirror.example.com",
    setupComponent: "HuggingFaceSetup",
    setupFields: [],
    enabled: true,
  };

  // ---- 代理（SDK v2：暴露 CORS 头） ----
  readonly proxy: ProxyConfig = { exposeHeaders: true };

  // ---- 搜索：models + datasets 并发合并 ----

  async doSearch(
    query: string,
    page: number,
    pageSize: number,
    pat?: string,
  ): Promise<GenericSearchResponse | null> {
    const headers: Record<string, string> = {
      "User-Agent": "CloudMirror/4.0",
      Accept: "application/json",
    };
    if (pat) headers["Authorization"] = `Bearer ${pat}`;

    const [modelsRes, datasetsRes] = await Promise.allSettled([
      fetch(
        `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&limit=${pageSize}&sort=downloads&direction=-1`,
        { headers },
      ),
      fetch(
        `https://huggingface.co/api/datasets?search=${encodeURIComponent(query)}&limit=${pageSize}&sort=downloads&direction=-1`,
        { headers },
      ),
    ]);

    const results: ReturnType<typeof this.mapSearchItem>[] = [];
    let total = 0;

    if (modelsRes.status === "fulfilled" && modelsRes.value.ok) {
      const data = (await modelsRes.value.json()) as Record<string, unknown>;
      const items = (Array.isArray(data) ? data : ((data.models as unknown[]) ?? [])) as unknown[];
      results.push(...items.map((raw: unknown) => this.mapSearchItem(raw)));
      total += (data.numTotalItems as number) ?? (data.numItemsPerPage as number) ?? items.length;
    }
    if (datasetsRes.status === "fulfilled" && datasetsRes.value.ok) {
      const data = (await datasetsRes.value.json()) as Record<string, unknown>;
      const items = (Array.isArray(data) ? data : ((data.models as unknown[]) ?? [])) as unknown[];
      const dsResults = items.map((raw: unknown) => {
        const item = this.mapSearchItem(raw);
        item.kind = "dataset";
        return item;
      });
      results.push(...dsResults);
      total += (data.numTotalItems as number) ?? (data.numItemsPerPage as number) ?? items.length;
    }

    return { results, total, page, pageSize };
  }

  // ---- 配置 ----

  defineResultMapping(): ResultMapping {
    return {
      itemsPath: "items",
      totalPath: "total",
      itemKind: "model",
      itemIdField: "id",
      fields: {
        title: "id",
        description: "description",
        author: "author",
        subtitle: "pipeline_tag",
        stats: [
          { key: "downloads", path: "downloads", label: "下载", format: "number" },
          { key: "likes", path: "likes", label: "Likes", format: "number" },
        ],
      },
    };
  }

  defineResultCard(): ResultCardConfig {
    return {
      titleTemplate: "{title}",
      badges: [],
      descriptionShow: true,
      stats: [
        { field: "stats.downloads", label: "下载" },
        { field: "stats.likes", label: "Likes" },
      ],
      quickCommands: [
        { label: "hf download", template: "hf download {title} --endpoint https://{domain}" },
      ],
      detailLink: "/detail?type=hf&target={id}",
    };
  }

  defineDetail(): DetailConfig {
    return {
      infoEndpoint: "https://huggingface.co/api/models/{target}",
      infoMapping: {
        title: "id",
        description: "description",
        author: "author",
        stats: [
          { label: "下载量", path: "downloads" },
          { label: "Likes", path: "likes" },
          { label: "Pipeline", path: "pipeline_tag" },
        ],
      },
      metaFields: { a: "id" },
      detailUrlTemplate: "https://huggingface.co/{target}",
      quickConnects: [
        { label: "hf download", template: "hf download {title} --endpoint https://{domain}" },
      ],
      tabs: [
        {
          id: "readme",
          label: "README",
          icon: { kind: "lucide", name: "BookOpen" },
          type: "markdown",
          dataSource: {
            endpoint: "https://huggingface.co/{target}/raw/main/README.md",
            responseType: "text",
            // README 相对图片基于仓库 main 分支 raw 路径（后端内嵌为 data URL）
            docBase: "https://huggingface.co/{target}/raw/main/",
          },
        },
      ],
    };
  }

  defineSetupGuide(): SetupGuideConfig {
    return {
      summary: "AI 模型与数据集加速下载。",
      quickCommand: "export HF_ENDPOINT=https://{domain}",
      sections: [
        {
          title: "CLI 命令行",
          items: [
            { label: "设置 endpoint", value: "export HF_ENDPOINT=https://{domain}", mode: "block" },
            { label: "下载模型", value: "hf download user/model", mode: "inline" },
          ],
        },
        {
          title: "Dataset 数据集下载",
          items: [
            {
              label: "下载数据集",
              value: "hf download user/dataset --repo-type dataset",
              mode: "inline",
            },
            {
              label: "下载单个文件",
              value: "hf download user/dataset filename.parquet --repo-type dataset",
              mode: "inline",
            },
          ],
        },
        {
          title: "Git Clone & LFS",
          items: [
            {
              label: "克隆模型仓库",
              value: "git clone https://{domain}/user/model",
              mode: "block",
            },
            {
              label: "克隆数据集仓库",
              value: "git clone https://{domain}/datasets/user/dataset",
              mode: "block",
            },
            {
              label: "克隆含 LFS 大文件",
              value:
                "GIT_LFS_SKIP_SMUDGE=1 git clone https://{domain}/user/model\ncd model && git lfs pull",
              mode: "block",
            },
          ],
        },
        {
          title: "Python SDK",
          items: [
            {
              label: "设置环境变量",
              value: 'import os\nos.environ["HF_ENDPOINT"] = "https://{domain}"',
              mode: "block",
            },
          ],
        },
      ],
    };
  }

  defineCredentialTypes() {
    return [{ value: "hf", label: "HuggingFace", authMode: "bearer" as const }];
  }

  definePopularSearches(): PopularSearch[] {
    return [
      { name: "meta-llama/Llama-3.1-8B", description: "Meta 大语言模型" },
      { name: "stabilityai/stable-diffusion-xl-base-1.0", description: "图像生成" },
      { name: "google/gemma-2-2b", description: "Google 轻量模型" },
    ];
  }
}

export const huggingfaceProvider = new HuggingFaceProvider();
