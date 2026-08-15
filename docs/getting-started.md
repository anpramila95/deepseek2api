# 快速上手

## 1. 环境要求

- Node.js 20.12+
- 能访问 DeepSeek Web、PoW wasm 地址以及项目启用的验证码服务
- 一个获得授权的 DeepSeek 账号

项目不依赖第三方 Node.js 包，因此克隆后不需要执行 `npm install`。

## 2. 创建本地配置

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

macOS / Linux：

```bash
cp .env.example .env
```

最小配置可保持默认值。需要管理员后台时，设置强密码：

```env
PORT=3000
APP_ADMIN_USERNAME=admin
APP_ADMIN_PASSWORD=replace-with-a-strong-password
```

`.env` 是本地敏感文件，已被 Git 忽略。

## 3. 启动服务

```bash
npm start
```

打开 `http://127.0.0.1:3000`。首次启动会自动创建 `data/app.json`，其中保存本地用户、会话、账号和设置。

## 4. 完成首次配置

1. 注册本地用户，或使用 `.env` 中的管理员账号登录。
2. 在“账号管理”中绑定 DeepSeek 账号。
3. 确认账号状态可用；遇到验证码时按页面提示手动处理，或由管理员配置自动处理。
4. 创建 API Key，并立即安全保存返回的明文 Key。
5. 如需工具调用，为该 API Key 显式开启工具调用开关。

## 5. 发起第一个请求

查看模型：

```bash
curl http://127.0.0.1:3000/v1/models \
  -H "Authorization: Bearer YOUR_LOCAL_API_KEY"
```

非流式聊天：

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_LOCAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "stream": false,
    "messages": [{"role": "user", "content": "用一句话介绍你自己"}]
  }'
```

流式聊天只需把 `stream` 设为 `true`。

## 6. 运行测试

```bash
npm test
```

测试使用 Node.js 内置测试运行器。涉及存储的测试会在操作系统临时目录创建隔离数据，不应向仓库写入测试数据库。

## 7. 重置本地状态

先停止服务，再删除 `data/app.json`。下次启动时会生成空状态。该操作会清除所有本地用户、会话、绑定账号、API Key、邀请码和系统设置，且无法从项目中恢复。

重置前如需备份，请按敏感文件处理备份副本，并参考[运维指南](operations.md)。
