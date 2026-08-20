# deepseek2api

deepseek2api 是一个基于 Node.js 原生 HTTP 模块实现的 DeepSeek Web 网关。它同时提供浏览器管理台、受限的 DeepSeek 原生接口代理，以及 OpenAI Chat Completions 兼容接口。

> [!IMPORTANT]
> 本项目不是 DeepSeek 官方 API。它依赖上游 Web 接口，兼容性可能随上游变化。请只使用已获授权的账号，并遵守服务条款、隐私要求与适用法律。

## 主要能力

| 模块 | 能力 |
| --- | --- |
| 浏览器管理台 | 本地用户、DeepSeek 账号、API Key、聊天会话、邀请码与系统设置 |
| OpenAI 兼容层 | 模型列表、Chat Completions、SSE 流式响应、结构化思考内容、图片输入与工具调用 |
| DeepSeek 代理层 | 路径白名单、PoW、验证码状态、token 刷新、超长输入分段、断流恢复与继续生成 |
| 多用户策略 | 账号所有权隔离、并发/频率限制、无痕会话清理、共享账号轮询 |
| 本地数据 | 单个 `data/app.json` 状态文件；不依赖外部数据库 |
| 运行方式 | 无第三方 Node.js 运行时依赖、无构建步骤 |

## 快速开始

要求：Node.js 20.12.0 或更高版本。

```powershell
Copy-Item .env.example .env
npm start
```

浏览器打开 `http://127.0.0.1:3000`，然后：

1. 注册本地用户并登录。
2. 绑定一个已获授权的 DeepSeek 账号。
3. 创建本地 API Key。
4. 使用该 Key 调用 OpenAI 兼容接口。

绑定账号时，服务会先确认上游的 `training_allowed=false`，确认失败则不会保存账号。默认也不会持久化 DeepSeek 登录名和密码。

如需管理员功能，在 `.env` 中设置非空凭据并重启服务：

```env
APP_ADMIN_USERNAME=admin
APP_ADMIN_PASSWORD=replace-with-a-strong-password
```

最小调用示例：

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_LOCAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

运行测试：

```bash
npm test
```

## 支持的模型

| 模型 | 思考内容 | 搜索 | 图片输入 | Expert |
| --- | --- | --- | --- | --- |
| `deepseek-chat` | 否 | 否 | 否 | 否 |
| `deepseek-chat-search` | 否 | 是 | 否 | 否 |
| `deepseek-reasoner` | 是 | 否 | 否 | 否 |
| `deepseek-reasoner-search` | 是 | 是 | 否 | 否 |
| `deepseek-chat-expert` | 否 | 否 | 否 | 是 |
| `deepseek-reasoner-expert` | 是 | 否 | 否 | 是 |
| `deepseek-vision` | 否 | 否 | 是 | 否 |
| `deepseek-vision-reasoner` | 是 | 否 | 是 | 否 |

搜索由模型名的 `-search` 后缀控制。Expert 模型不支持文件或图片；图片内容块只允许 Vision 模型。

## 文档库

- [快速上手](docs/getting-started.md)
- [配置参考](docs/configuration.md)
- [API 参考](docs/api-reference.md)
- [架构说明](docs/architecture.md)
- [数据存储与清理](docs/data-storage.md)
- [安全与隐私](docs/security-and-privacy.md)
- [运维指南](docs/operations.md)
- [开发指南](docs/development.md)
- [故障排查](docs/troubleshooting.md)

## 项目结构

```text
deepseek2api/
├─ data/                 # 运行时状态目录；仓库仅保留 .gitkeep
├─ docs/                 # 项目文档库
├─ public/               # 无构建步骤的浏览器管理台
├─ src/
│  ├─ routes/            # 本地 API、OpenAI API 与代理路由
│  ├─ services/          # 认证、账号、协议、桥接与策略逻辑
│  ├─ storage/           # JSON 状态存储
│  └─ utils/             # HTTP、SSE、隐私脱敏等工具
├─ test/                 # Node.js 内置测试
├─ .env.example          # 无凭据的配置模板
└─ package.json
```

## 数据与安全

- `.env`、`data/app.json`、日志、浏览器调试产物和测试输出均被 Git 忽略。
- `data/app.json` 可能包含上游 token、登录会话、设备档案和验证码服务密钥，应按敏感数据库保护。
- 本地 API Key 明文仅在创建时返回一次，磁盘只保存 SHA-256 哈希与预览。
- 本项目默认配置不是面向公网的安全基线；部署前必须阅读[安全与隐私](docs/security-and-privacy.md)与[运维指南](docs/operations.md)。
- 完整清空本地状态的方法见[数据存储与清理](docs/data-storage.md)。

## 兼容性边界

当前只实现 OpenAI 的 Models 与 Chat Completions 子集，不包含 Responses、Embeddings、Audio 或 Files API。工具调用通过提示词与输出解析适配，不能假定所有 OpenAI 边界行为都完全一致。

## License

[MIT](LICENSE)
