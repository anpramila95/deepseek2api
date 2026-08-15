# deepseek2api 文档库

这里保存项目的维护文档。README 面向第一次接触项目的使用者，本目录覆盖配置、接口、架构、安全、运维和开发细节。

## 使用者文档

| 文档 | 内容 |
| --- | --- |
| [快速上手](getting-started.md) | 环境要求、启动、首次配置和第一个请求 |
| [配置参考](configuration.md) | `.env`、管理台设置和配置优先级 |
| [API 参考](api-reference.md) | OpenAI 兼容接口、本地管理接口和代理接口 |
| [安全与隐私](security-and-privacy.md) | 敏感数据、认证边界、清理和部署注意事项 |

## 维护者文档

| 文档 | 内容 |
| --- | --- |
| [架构说明](architecture.md) | 组件、请求流、状态模型和目录职责 |
| [运维指南](operations.md) | 部署、健康检查、备份、升级和故障排查 |
| [开发指南](development.md) | 测试、代码组织、改动流程和提交前检查 |

## 推荐阅读路径

- 本地体验：快速上手 → 配置参考 → API 参考
- 部署维护：安全与隐私 → 运维指南 → 架构说明
- 功能开发：架构说明 → 开发指南 → API 参考

## 文档维护约定

- 文档描述应以当前工作树代码为准，不记录本地账号、密钥、token、截图或真实请求样本。
- 新增环境变量时，同时更新 `.env.example` 和 `configuration.md`。
- 新增或删除路由时，同时更新 `api-reference.md`。
- 改变运行时存储结构、安全默认值或外部依赖时，同时更新 `security-and-privacy.md` 与 `operations.md`。
