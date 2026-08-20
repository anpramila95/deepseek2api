# 故障排查

建议先记录以下信息：Node.js 版本、Git 提交、操作路径、HTTP 状态码、是否流式、模型、账号状态，以及经过脱敏的错误文本。不要粘贴 Bearer Key、Cookie、DeepSeek token、密码或完整数据库。

## 服务无法启动

### `loadEnvFile` 或语法相关错误

确认 Node.js 版本：

```bash
node --version
```

必须为 20.12.0 或更高版本。然后执行：

```bash
npm test
```

### `Invalid DEEPSEEK_API_VERSION`

只接受数字版本，可写成 `v0` 或 `0`。空值使用默认 `v0`。

### 端口被占用

修改 `.env` 中的 `PORT`，或停止占用该端口的进程，然后重启。不要同时启动两个指向同一 `data/app.json` 的实例。

### `data/app.json` JSON 解析失败

立即停服务并复制损坏文件。优先从匹配代码版本的备份恢复；没有备份时只能删除文件并重新初始化。不要在服务运行中反复手工修复。

## 管理员无法登录

管理员只有在 `APP_ADMIN_USERNAME` 和 `APP_ADMIN_PASSWORD` 都非空时启用。检查：

1. `.env` 是否位于进程工作目录；
2. 两个值是否都设置；
3. 修改后是否重启；
4. 服务管理器是否注入了不同的同名环境变量；
5. 是否误用了普通用户凭据。

管理员比较区分大小写。不要在诊断输出中打印密码。

## 普通用户无法注册

常见原因：

- 管理员开启了邀请码要求但没有提供邀请码；
- 邀请码无效、已使用或大小写/空白处理后不匹配；
- 用户名已存在；
- 用户名或密码为空。

新数据库默认不要求邀请码。若意外回到开放注册，检查数据库是否被重置。

## 登录后立即变成未登录

- 用户可能被管理员禁用，禁用会清除会话。
- Cookie 可能被浏览器策略、HTTP/HTTPS 混用或反向代理路径处理丢弃。
- `data/app.json` 可能被恢复成不包含该会话的版本。
- 会话有效期为 7 天；过期会在读取时移除。

Cookie 当前没有 `Secure` 属性。部署在 HTTPS 反向代理后时，应同时检查代理的 Cookie 与安全策略。

## DeepSeek 账号绑定失败

绑定是多阶段事务，任何阶段失败都可能阻止保存：

1. 登录失败；
2. 风控或验证码；
3. 关闭数据优化失败；
4. 上游确认的 `training_allowed` 不是 `false`；
5. 客户端设置报告失败。

先确认账号能在官方 Web 正常登录，并检查上游状态码与脱敏错误。不要通过高频重复登录绕过风控。

默认不会保存原始登录凭据，因此 token 失效且刷新需要密码时，可能需要重新绑定账号。

## 账号显示 `captcha_required`

可在管理台：

- 提交手动验证结果；
- 强制重试自动处理；
- 清除本地验证码状态后重新尝试。

自动处理还需要正确的 Endpoint、密钥、开关、重试次数和冷却时间。第三方处理前先确认数据合规。清除本地状态不等于解除上游风控。

## API 返回 `401 Invalid API key`

检查：

- Header 是否为 `Authorization: Bearer <key>`；
- 是否误传了 Key 预览而非创建时返回的完整 Key；
- Key 是否已删除或数据库已重置；
- 是否有前后空格或代理剥离了 Authorization；
- 调用的是否是同一实例和数据库。

Key 明文不可从数据库恢复，只能删除记录并新建。

## API 返回 `404 Account not found`

可能没有可用账号，或 Key 绑定账号已删除、token 缺失、账号处于验证码状态。重新绑定可用账号并创建或调整 Key。

共享账号模式下，创建 Key 的用户自己也必须先拥有一个可用账号。

## API 返回 `403 User is disabled`

管理员已禁用该本地用户。管理员重新启用后，用户需要再次登录。

## API 返回 `429`

本地 429 通常来自用户并发或每分钟请求限制。管理台检查 `maxConcurrency` 与 `maxRequestsPerMinute`。

上游特定“消息发送过于频繁”错误由另一个机制处理：默认保持 SSE 心跳，等待 30 秒、切换账号并最多重试 3 次。其他上游限流不会进入该重试路径。

## 工具调用被拒绝或没有返回

### `Tool calls are disabled for this API key`

在管理台为该 Key 开启工具调用，或用 `PATCH /api/api-keys/:id` 更新 `toolCallsEnabled`。

### 强制工具没有满足

确认：

- `tools` 中声明了正确函数名；
- `tool_choice` 格式正确；
- schema 足够清晰；
- 模型输出没有把调用包在示例代码块；
- 工具解析模式是否适合当前输出。

网关会过滤未声明函数，工具调用是提示词适配，不具备官方原生工具协议的全部保证。

### 流式请求看起来被缓冲

开启工具解析模式且检测到结构化工具字段时，会执行二次格式化并缓冲结果。这是当前设计。反向代理缓冲也会造成类似症状，应对 SSE 禁用代理缓冲。

## 图片或文件被拒绝

- `image_url` 只能用于 `deepseek-vision` 或 `deepseek-vision-reasoner`。
- Expert 模型不支持图片和文件。
- 普通模型可以使用 `ref_file_ids`，但不接受 `image_url`。
- 请求体和反向代理上传限制必须足够。

典型错误：`Image inputs require deepseek-vision...` 或 `Expert models do not support file or image uploads`。

## 搜索请求被拒绝

不要发送 `web_search_options`。选择：

- `deepseek-chat-search`
- `deepseek-reasoner-search`

Vision 与 Expert 当前没有搜索模型变体。

## SSE 中断、重复或长时间无正文

服务会区分思考、正文、`close` 和消息状态：

- Reasoner 可能长时间只发送 `reasoning_content`；
- 等待时每 10 秒应有 `: keep-alive`；
- 传输中断会调用 `resume_stream`；
- `INCOMPLETE` 会调用 `continue`；
- 恢复快照会做重叠去重。

排查顺序：

1. 使用 `curl -N` 排除客户端缓冲；
2. 禁用反向代理 SSE 缓冲与短读取超时；
3. 检查恢复/继续上限和延迟配置；
4. 检查上游验证码、限流或业务错误；
5. 运行 completion、SSE 与频繁发送相关测试。

达到上限时会返回错误并保留上游会话，避免错误地执行无痕删除。

## 前端样式或脚本没有更新

HTML、CSS 和 JS 使用 no-store/no-cache 策略，并对 HTML 发送 `Clear-Site-Data: "cache"`。仍异常时：

1. 强制刷新页面；
2. 检查反向代理或 CDN 是否覆盖缓存头；
3. 确认浏览器能访问 Google Fonts 与 jsDelivr；
4. 查看控制台是否有模块或外部脚本加载错误；
5. 直接请求对应静态文件核对内容。

高安全或离线环境应自托管外部资源。

## 测试失败

先确认工作区和版本：

```bash
node --version
git status --short
npm test
```

测试不应使用真实 `data/app.json`。如果失败留下临时目录，通常位于系统临时目录而非项目 `data/`。不要为了让测试通过而提交生成的数据库、日志或截图。

## 请求帮助时提供什么

可以提供：

- 精确提交 ID；
- Node.js 与操作系统版本；
- 请求路径、模型、流式与否；
- HTTP 状态码和脱敏错误；
- 最小可复现请求，把 Key 替换为占位符；
- 相关测试结果。

不要提供 `.env`、`data/app.json`、Authorization、Cookie、密码、token、验证码密钥、真实邮箱/手机号或未脱敏截图。
