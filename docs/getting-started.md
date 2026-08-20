# 快速上手

本指南从一个不含运行数据的仓库开始，完成本地启动、账号绑定、API Key 创建和首次请求。

## 1. 环境要求

- Node.js 20.12.0 或更高版本
- 一个已获授权使用的 DeepSeek 账号
- 支持现代 JavaScript 的浏览器

项目没有第三方 Node.js 运行时依赖，也没有前端构建步骤。通常不需要先执行 `npm install`。

确认环境：

```bash
node --version
npm --version
```

## 2. 创建本地配置

PowerShell：

```powershell
Copy-Item .env.example .env
```

Bash：

```bash
cp .env.example .env
```

最小配置可以只保留端口：

```env
PORT=3000
```

管理员功能默认关闭。需要管理员功能时，设置两个非空值：

```env
APP_ADMIN_USERNAME=admin
APP_ADMIN_PASSWORD=replace-with-a-strong-password
```

不要把 `.env` 提交到 Git。全部选项见[配置参考](configuration.md)。

## 3. 启动服务

```bash
npm start
```

控制台出现以下信息即表示监听成功：

```text
Server listening on http://127.0.0.1:3000
```

打开 `http://127.0.0.1:3000`。首次访问状态存储时会创建 `data/app.json`。

> [!CAUTION]
> 代码只指定端口，没有限制监听主机。即使日志显示 `127.0.0.1`，操作系统也可能在所有接口上监听。请用防火墙或反向代理限制访问。

## 4. 注册与登录

新数据库默认允许无邀请码注册。注册一个本地用户后会自动建立登录会话。

如果配置了管理员账号，可在同一登录页面使用管理员凭据。管理员能够：

- 开关邀请码注册；
- 管理用户、邀请码和用户请求限制；
- 配置验证码、输入分段、全局实验选项；
- 开关全局无痕与共享账号模式。

## 5. 绑定 DeepSeek 账号

在管理台的账号区域输入 DeepSeek 登录名和密码。绑定流程会：

1. 为账号生成并固定一套客户端设备档案；
2. 登录 DeepSeek Web 并获取上游 token；
3. 关闭上游“数据用于优化体验”设置；
4. 仅在确认 `training_allowed=false` 后写入本地状态；
5. 向上游报告客户端设置。

默认 `PERSIST_ACCOUNT_CREDENTIALS=false`，因此原始登录名与密码不会落盘；上游 token、脱敏标识和设备档案仍会写入 `data/app.json`。

## 6. 创建 API Key

进入 API Key 区域，选择已绑定的可用账号并创建 Key。可按需开启工具调用。

明文 Key 只展示一次，形式类似：

```text
dsr_...
```

请立即保存到调用方的秘密管理设施。数据库只保留哈希，无法找回原 Key。

## 7. 验证接口

列出模型：

```bash
curl http://127.0.0.1:3000/v1/models \
  -H "Authorization: Bearer YOUR_LOCAL_API_KEY"
```

发起非流式对话：

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_LOCAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "stream": false,
    "messages": [{"role": "user", "content": "请只回复 OK"}]
  }'
```

发起流式对话：

```bash
curl -N http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_LOCAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-reasoner",
    "stream": true,
    "messages": [{"role": "user", "content": "解释二分查找"}]
  }'
```

Reasoner 的思考文本位于 `reasoning_content`，不会混入 `content`。

## 8. 运行测试

```bash
npm test
```

测试使用 Node.js 内置测试运行器；涉及状态的用例在系统临时目录创建隔离工作区，不需要真实账号。

## 下一步

- 调用参数与接口清单：[API 参考](api-reference.md)
- 环境变量与运行时设置：[配置参考](configuration.md)
- 生产部署注意事项：[运维指南](operations.md)
- 凭据和数据库风险：[安全与隐私](security-and-privacy.md)
- 常见错误：[故障排查](troubleshooting.md)
