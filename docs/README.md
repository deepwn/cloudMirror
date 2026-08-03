# cloudMirror 文档索引

| 文档                                 | 定位                                                               |
| ------------------------------------ | ------------------------------------------------------------------ |
| [architecture.md](./architecture.md) | **架构设计**（权威）— 执行流程路径、核心组件、开发基准、关键不变量 |
| [development.md](./development.md)   | **开发规范** — 环境、代码规范、测试要求、贡献流程                  |
| [providers-memo.md](./providers-memo.md) | **Provider 运维备忘录** — 逐 Provider 代理/搜索/鉴权分析、PAT 验证流程矩阵、Docker 401 根因、参考项目 |
| [README.md](../README.md)            | 项目介绍与部署指南                                                 |

## 维护约定

- 架构变更（新增路径/组件/不变量）必须同步更新 `architecture.md`
- 代码规范变更必须同步更新 `development.md`
- 新增 Provider 前阅读 `architecture.md` §4 开发基准
