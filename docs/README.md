# deepseek2api 文档库

这里是与当前源码配套的项目文档。根目录 [README](../README.md) 用于快速了解项目，本目录提供完整的使用、运维和开发资料。

## 按角色阅读

### 使用者

1. [快速上手](getting-started.md)
2. [API 参考](api-reference.md)
3. [故障排查](troubleshooting.md)

### 管理员与运维人员

1. [配置参考](configuration.md)
2. [数据存储与清理](data-storage.md)
3. [安全与隐私](security-and-privacy.md)
4. [运维指南](operations.md)

### 开发者

1. [架构说明](architecture.md)
2. [开发指南](development.md)
3. [API 参考](api-reference.md)

## 文档地图

| 文档 | 内容 |
| --- | --- |
| [快速上手](getting-started.md) | 从空仓库启动到完成首次 API 请求 |
| [配置参考](configuration.md) | `.env`、默认值、格式与管理台持久化设置 |
| [API 参考](api-reference.md) | OpenAI 兼容、本地管理和 DeepSeek 代理接口 |
| [架构说明](architecture.md) | 组件、数据流、恢复流程和边界 |
| [数据存储与清理](data-storage.md) | 状态结构、敏感字段、备份、恢复和重置 |
| [安全与隐私](security-and-privacy.md) | 安全模型、已实现保护、已知限制和部署清单 |
| [运维指南](operations.md) | 启动、健康检查、反向代理、升级和事件处理 |
| [开发指南](development.md) | 代码组织、测试、扩展方式和提交检查 |
| [故障排查](troubleshooting.md) | 常见症状、原因与处理顺序 |

## 文档维护原则

- 配置默认值以 `src/config.js` 为准。
- OpenAI 模型清单以 `src/services/openai-request.js` 为准。
- 本地路由以 `src/routes/` 为准。
- 代理白名单以 `src/config.js` 的 `allowedProxyRouteSuffixes` 为准。
- 数据结构以 `src/storage/store.js` 为准。

修改上述源码时，应在同一提交中更新相应文档。
