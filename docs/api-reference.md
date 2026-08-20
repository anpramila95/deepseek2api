# API 参考

本文记录当前源码直接提供的 HTTP 接口。OpenAI 兼容层只实现 Models 和 Chat Completions 子集。

## 通用约定

默认基地址：

```text
http://127.0.0.1:3000
```

### 认证

| 接口族 | 认证方式 |
| --- | --- |
| 公共 `/api/*` | 无认证或可选 `ds_reverse_session` Cookie |
| 私有与管理员 `/api/*` | `ds_reverse_session` HttpOnly Cookie |
| `/proxy/*` | 同一会话 Cookie；可选 `x-proxy-account-id` |
| `/v1/*`、`/models` | `Authorization: Bearer <本地 API Key>` |

### 错误

未开始流式响应时，错误为脱敏后的简单 JSON：

```json
{ "error": "错误描述" }
```

这与 OpenAI 常见的嵌套 `error` 对象不同。SSE 已开始后发生错误时，服务会尽量发送带 `error` 对象的数据帧并以 `[DONE]` 结束，或在无法继续写入时关闭连接。

### 请求体

服务级请求体上限固定为 110 MiB。JSON 解析失败通常返回 `400`；超过限制目前会进入通用错误路径。

## OpenAI 兼容接口

### `GET /v1/models`

别名：`GET /models`。`/v1/models/` 与 `/models/` 尾斜杠形式也可用。必须携带 Bearer Key。返回：

```json
{
  "object": "list",
  "data": [
    {
      "id": "deepseek-chat",
      "object": "model",
      "created": 0,
      "owned_by": "deepseek-web"
    }
  ]
}
```

模型列表请求也会计入 API Key 当日使用量，并受用户请求限制约束。

### `POST /v1/chat/completions`

尾斜杠形式 `/v1/chat/completions/` 也可用。

当前直接处理的字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `model` | string | 可选，默认 `deepseek-chat` |
| `messages` | array | OpenAI 风格消息；文本或 `image_url` 内容块 |
| `stream` | boolean | `true` 返回 SSE；否则返回单个 JSON |
| `tools` | array | 函数工具定义；对应 API Key 必须开启工具调用 |
| `tool_choice` | string/object | `none`、自动或指定函数策略 |
| `ref_file_ids` | array | 已存在的 DeepSeek 文件 ID |

未列出的 OpenAI 参数不保证生效。`web_search_options` 会被明确拒绝；搜索必须选择 `-search` 模型。

最小请求：

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_LOCAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

非流式响应包含 `id`、`object`、`created`、`model` 和一个 choice。当前不生成 `usage` 字段：

```json
{
  "id": "chatcmpl_...",
  "object": "chat.completion",
  "created": 0,
  "model": "deepseek-chat",
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "message": {
        "role": "assistant",
        "content": "你好"
      }
    }
  ]
}
```

`created` 在实际响应中是当前 Unix 秒；上例使用 `0` 作为示意值。

流式响应使用 `text/event-stream`，每帧对象为 `chat.completion.chunk`，以 `data: [DONE]` 结束。等待上游时每 10 秒发送 `: keep-alive` 注释。

### 思考内容

Reasoner 模型使用结构化字段：

- 非流式：`choices[0].message.reasoning_content`
- 流式：`choices[0].delta.reasoning_content`

思考内容不会拼入 `content`，也不会用 `<think>` 标签包裹。

### 图片与文件

图片内容块示例：

```json
{
  "model": "deepseek-vision",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "描述图片" },
        {
          "type": "image_url",
          "image_url": { "url": "https://example.com/image.png", "detail": "auto" }
        }
      ]
    }
  ]
}
```

约束：

- `image_url` 只允许 `deepseek-vision` 和 `deepseek-vision-reasoner`。
- Expert 模型不允许图片或 `ref_file_ids`。
- 其他模型可传 `ref_file_ids`，但不能传 `image_url`。

### 工具调用

工具调用需要同时满足：

1. 创建或更新 API Key 时启用 `toolCallsEnabled`；
2. 请求中提供 `tools`；
3. `tool_choice` 没有设为 `none`。

网关把工具 schema 和历史工具消息转换为提示词协议，再从模型输出解析声明过的函数。未声明的函数会被过滤；强制工具未满足时请求失败。成功时：

- 非流式 `finish_reason` 为 `tool_calls`，调用位于 `message.tool_calls`；
- 流式调用位于 `delta.tool_calls`，结束帧 `finish_reason` 为 `tool_calls`。

开启个人或全局“工具解析模式”后，如果初次正文含结构化工具字段，服务会把正文和工具提示交给 `deepseek-chat` 快速模式二次格式化。该两阶段路径会先缓冲结果，因此即使请求了流式输出，也不会实时转发第一阶段 token。

### 自动恢复、继续与频繁发送重试

- 上游 SSE 在逻辑结束前断开：调用 `/chat/resume_stream`。
- 上游消息状态为 `INCOMPLETE`：调用 `/chat/continue`。
- 合并响应时对重复快照片段去重。
- 仅匹配特定“消息发送过于频繁，请稍后重试”错误时，等待 30 秒并切换账号，默认最多重试 3 次。
- 达到恢复/继续上限、限流或上游错误时返回失败，并保留可能可恢复的上游会话。
- 无痕模式只在逻辑响应确认完整后删除会话。

### 模型清单

| 模型 | 上游类型 | 思考 | 搜索 | 图片 | 文件 |
| --- | --- | --- | --- | --- | --- |
| `deepseek-chat` | default | 否 | 否 | 否 | 是 |
| `deepseek-chat-search` | default | 否 | 是 | 否 | 是 |
| `deepseek-reasoner` | default | 是 | 否 | 否 | 是 |
| `deepseek-reasoner-search` | default | 是 | 是 | 否 | 是 |
| `deepseek-chat-expert` | expert | 否 | 否 | 否 | 否 |
| `deepseek-reasoner-expert` | expert | 是 | 否 | 否 | 否 |
| `deepseek-vision` | vision | 否 | 否 | 是 | 是 |
| `deepseek-vision-reasoner` | vision | 是 | 否 | 是 | 是 |

### 未实现的 OpenAI 接口

当前没有 Responses、Embeddings、Images、Audio、Files、Fine-tuning、Batches 或 Assistants API。

## 本地管理 API

### 公共接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/me` | 匿名状态或当前会话载荷 |
| `GET` | `/api/discovery` | 版本化代理白名单和协议清单 |
| `GET` | `/api/protocol` | 上游版本、路由分组和风控策略 |
| `POST` | `/api/auth/login` | 管理员或本地用户登录 |
| `POST` | `/api/auth/register` | 注册本地用户；可受邀请码策略限制 |
| `POST` | `/api/auth/logout` | 删除服务端会话并清除 Cookie |

登录和注册请求体：

```json
{
  "username": "local-user",
  "password": "a-strong-password",
  "inviteCode": "INV-..."
}
```

`inviteCode` 只在启用邀请码注册时需要。

### 已登录用户接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/request-logs?limit=100` | 当前所有者日志；管理员可见全部；范围 `1..500` |
| `GET` | `/api/accounts` | 当前会话可见账号 |
| `POST` | `/api/accounts` | 用 `username`、`password` 绑定账号并关闭数据优化 |
| `DELETE` | `/api/accounts/:id` | 删除范围内账号 |
| `POST` | `/api/accounts/:id/captcha/resolve` | 提交手动验证码结果 |
| `POST` | `/api/accounts/:id/captcha/retry` | 强制再次尝试自动处理 |
| `POST` | `/api/accounts/:id/captcha/clear` | 清除本地验证码状态 |
| `POST` | `/api/incognito` | 管理员更新全局无痕；普通用户更新个人无痕 |
| `POST` | `/api/chain-of-thought-override` | 更新当前所有者的实验开关 |
| `POST` | `/api/tool-parsing-mode` | 更新当前所有者的工具解析模式 |
| `GET` | `/api/api-keys` | 列出当前所有者的 Key 元数据和当日使用量 |
| `POST` | `/api/api-keys` | 创建 Key；明文只返回一次 |
| `PATCH` | `/api/api-keys/:id` | 更新 `toolCallsEnabled` |
| `DELETE` | `/api/api-keys/:id` | 删除 Key |

创建 Key：

```json
{
  "accountId": "ACCOUNT_ID",
  "label": "local-client",
  "plainKey": "",
  "toolCallsEnabled": false
}
```

`plainKey` 为空或省略时，服务端生成高熵 `dsr_...` Key。共享账号模式下，用户仍需先拥有至少一个可用账号才能创建 Key。

三个布尔开关接口的请求体均为：

```json
{ "enabled": true }
```

### 管理员接口

仅管理员会话可用：

| 方法 | 路径 | 请求重点 |
| --- | --- | --- |
| `POST` | `/api/admin/registration` | `inviteRequired` |
| `POST` | `/api/admin/shared-account-mode` | `enabled` |
| `POST` | `/api/admin/system-settings` | 验证码、输入上限和全局实验设置 |
| `POST` | `/api/admin/invites` | `count`，正整数 |
| `POST` | `/api/admin/invites/batch-delete` | `inviteIds` |
| `DELETE` | `/api/admin/invites/:id` | 删除单个邀请码 |
| `POST` | `/api/admin/users/batch-delete` | `userIds` |
| `POST` | `/api/admin/users/batch-disable` | `userIds`、`disabled` |
| `PATCH` | `/api/admin/users/:id` | `disabled`、`requestLimits` |
| `DELETE` | `/api/admin/users/:id` | 删除用户及其关联状态 |

用户限制对象：

```json
{
  "requestLimits": {
    "maxConcurrency": 2,
    "maxRequestsPerMinute": 30
  }
}
```

空字符串或 `null` 表示不限；非空值必须为正整数。限制计数只在内存中，重启会重置。

开启共享账号模式前必须：

1. 开启全局无痕；
2. 至少绑定一个全局可用账号。

## DeepSeek 原生代理

调用形式：

```text
/proxy/<上游路径后缀>
```

服务把它映射为 `/api/<DEEPSEEK_API_VERSION>/<后缀>`。可用 `x-proxy-account-id` 选择当前会话可见账号；省略时选择第一个。

当前白名单：

| 分组 | 路径后缀 |
| --- | --- |
| Chat | `/chat/completion`、`/chat/continue`、`/chat/create_pow_challenge`、`/chat/edit_message`、`/chat/history_messages`、`/chat/message_feedback`、`/chat/regenerate`、`/chat/resume_stream`、`/chat/stop_stream` |
| Session | `/chat_session/create`、`/chat_session/delete`、`/chat_session/delete_all`、`/chat_session/fetch_page`、`/chat_session/update_pinned`、`/chat_session/update_title` |
| Client | `/client/settings`、`/client/settings/report`、`/client/span`、`/client/wechat_js_sdk_signature` |
| File / Index | `/file/fetch_files`、`/file/fork_file_task`、`/file/preview`、`/file/upload_file`、`/index/prepare`、`/index/query` |
| Share | `/share/content`、`/share/create`、`/share/delete`、`/share/fork`、`/share/list` |
| User | `/users/current`、`/users/logout_all_sessions`、`/users/set_birthday`、`/users/settings`、`/users/update_settings` |
| Export | `/download_export_history`、`/export_all` |

代理拒绝白名单外路径，并移除上游 `set-cookie`、`content-length`、`content-encoding` 与 hop-by-hop 响应头。

`POST /proxy/chat/completion` 是协议感知的逻辑流，支持超长输入分段、恢复、继续、去重和完整后无痕清理。其他白名单路径主要做受控流转发。
