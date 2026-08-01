// ============================================================================
// src/providers/maven.provider.ts — Maven Central Provider
// ============================================================================

import { ProviderDefinition } from "./_base";
import type {
  ProviderMeta,
  SearchConfig,
  ResultMapping,
  ResultCardConfig,
  DetailConfig,
  SetupGuideConfig,
  PopularSearch,
} from "../shared/types";

export class MavenProvider extends ProviderDefinition {
  readonly id = "maven";
  // 根路径：用户配置 https://{domain}/maven2，代理拼接 path 后直达 repo1.maven.org/maven2/...
  readonly upstream = "https://repo1.maven.org";
  readonly authMode = "none" as const;

  readonly meta: ProviderMeta = {
    id: "maven",
    name: "Maven Central",
    label: "Maven",
    icon: { kind: "simple-icons", name: "siApachemaven", colored: true },
    description: "Java/Kotlin Maven 仓库镜像加速",
    searchEnabled: true,
    searchLabel: "搜索 Maven 构件...",
    searchHint: "mvn dependency:get -DremoteRepositories=https://{domain}/maven2",
    setupComponent: "MavenSetup",
    setupFields: [],
    enabled: true,
  };

  // ---- 搜索（声明式） ----

  readonly search: SearchConfig = {
    endpoint: "https://search.maven.org/solrsearch/select",
    pagination: "offset",
    pageSizeParam: "rows",
    offsetParam: "start",
    extraParams: { wt: "json" },
  };

  // ---- 配置 ----

  defineResultMapping(): ResultMapping {
    return {
      itemsPath: "response.docs",
      totalPath: "response.numFound",
      itemKind: "package",
      itemIdField: "id",
      fields: {
        title: "a",
        description: "id",
        subtitle: "latestVersion",
        url: undefined,
        stats: [
          {
            key: "groupId",
            path: "g",
            label: "Group ID",
            format: "text",
          },
        ],
      },
    };
  }

  defineResultCard(): ResultCardConfig {
    return {
      titleTemplate: "{title}",
      badges: [{ text: "{subtitle}", variant: "secondary" }],
      descriptionShow: true,
      stats: [{ field: "stats.groupId", label: "Group" }],
      quickCommands: [
        {
          label: "Maven",
          template: "group: {stats.groupId}  artifact: {title}  version: {subtitle}",
        },
        { label: "Gradle", template: "implementation '{g}:{a}:{v}'" },
      ],
      detailLink: "/detail?type=maven&target={id}",
    };
  }

  defineDetail(): DetailConfig {
    return {
      infoEndpoint: "https://search.maven.org/solrsearch/select?q=id:%22{target}%22&rows=1&wt=json",
      infoMapping: {
        title: "response.docs[0].a",
        description: "response.docs[0].id",
        stats: [
          {
            label: "Group ID",
            path: "response.docs[0].g",
          },
          {
            label: "最新版本",
            path: "response.docs[0].latestVersion",
          },
          {
            label: "版本数",
            path: "response.docs[0].versionCount",
          },
        ],
      },
      metaFields: {
        version: "response.docs[0].latestVersion",
        g: "response.docs[0].g",
        a: "response.docs[0].a",
      },
      detailUrlTemplate: "https://mvnrepository.com/artifact/{target}",
      quickConnects: [
        {
          label: "Maven",
          template:
            "<dependency>\n  <groupId>{g}</groupId>\n  <artifactId>{a}</artifactId>\n  <version>{version}</version>\n</dependency>",
        },
        { label: "Gradle (Groovy)", template: "implementation '{g}:{a}:{version}'" },
        { label: "Gradle (Kotlin)", template: 'implementation("{g}:{a}:{version}")' },
      ],
      tabs: [
        {
          id: "versions",
          label: "版本列表",
          icon: { kind: "lucide", name: "Tag" },
          type: "table",
          dataSource: {
            endpoint:
              "https://search.maven.org/solrsearch/select?q=id:%22{target}%22&core=gav&rows=50&wt=json",
            responsePath: "response.docs",
            columns: [
              { field: "v", label: "版本号" },
              { field: "p", label: "类型" },
              { field: "timestamp", label: "更新时间", format: "date" },
            ],
          },
        },
      ],
    };
  }

  defineSetupGuide(): SetupGuideConfig {
    return {
      summary: "配置 Maven 或 Gradle 使用 cloudMirror 镜像加速依赖下载。",
      quickCommand: "mvn dependency:get -DremoteRepositories=https://{domain}/maven2",
      sections: [
        {
          title: "Maven (settings.xml)",
          items: [
            {
              label: "全局或用户 settings.xml",
              value:
                "<settings>\n  <mirrors>\n    <mirror>\n      <id>cloudmirror</id>\n      <mirrorOf>central</mirrorOf>\n      <url>https://{domain}/maven2</url>\n    </mirror>\n  </mirrors>\n</settings>",
              mode: "block",
            },
          ],
        },
        {
          title: "Gradle (Groovy DSL)",
          items: [
            {
              label: "build.gradle",
              value:
                "repositories {\n    mavenCentral()\n    maven { url 'https://{domain}/maven2' }\n}",
              mode: "block",
            },
          ],
        },
        {
          title: "Gradle (Kotlin DSL)",
          items: [
            {
              label: "build.gradle.kts",
              value:
                'repositories {\n    mavenCentral()\n    maven { url = uri("https://{domain}/maven2") }\n}',
              mode: "block",
            },
          ],
        },
        {
          title: "环境变量 (全局覆盖)",
          items: [
            {
              label: "MAVEN_MIRROR_URL",
              value: "export MAVEN_MIRROR_URL=https://{domain}/maven2",
              mode: "block",
            },
          ],
        },
        {
          title: "CI/CD 配置",
          items: [
            {
              label: "GitHub Actions (Maven)",
              value:
                "- name: Set up JDK\n  uses: actions/setup-java@v4\n  with:\n    java-version: '21'\n    distribution: 'temurin'\n\n- name: Configure Maven mirror\n  run: |\n    mkdir -p ~/.m2\n    echo '<settings><mirrors><mirror><id>cloudmirror</id><mirrorOf>central</mirrorOf><url>https://{domain}/maven2</url></mirror></mirrors></settings>' > ~/.m2/settings.xml",
              mode: "block",
            },
            {
              label: "GitHub Actions (Gradle)",
              value:
                "- name: Set up JDK\n  uses: actions/setup-java@v4\n  with:\n    java-version: '21'\n    distribution: 'temurin'\n\n- name: Configure Gradle mirror\n  run: |\n    echo \"allprojects { repositories { maven { url 'https://{domain}/maven2' } } }\" >> build.gradle",
              mode: "block",
            },
          ],
        },
      ],
    };
  }

  definePopularSearches(): PopularSearch[] {
    return [
      { name: "spring-boot", description: "Spring Boot Starter" },
      { name: "guava", description: "Google Core Libraries" },
      { name: "jackson-databind", description: "JSON 处理" },
      { name: "lombok", description: "代码简化工具" },
    ];
  }
}

export const mavenProvider = new MavenProvider();
