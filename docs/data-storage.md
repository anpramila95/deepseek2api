# 数据存储与清理

## 存储位置

项目不连接外部数据库。持久状态全部写入：

```text
data/app.json
```

仓库只跟踪 `data/.gitkeep`。`.gitignore` 排除 `data/*`、常见数据库扩展名、日志和临时产物。

首次调用存储层时，如果 `data/app.json` 不存在，会创建一份默认空状态。仅启动进程但没有触发状态读取时，文件不一定立即出现。

## 状态分区

默认结构的业务含义如下：

| 字段 | 持久内容 |
| --- | --- |
| `accounts` | DeepSeek 账号、上游 token、脱敏标识、设备档案、验证码与隐私设置状态 |
| `apiKeys` | 本地 Key 哈希、预览、所有权、账号关系、当日使用量、工具权限 |
| `users` | 本地用户名、密码盐与哈希、禁用状态、请求限制 |
| `sessions` | 管理台登录会话 ID、角色、所有权和过期时间 |
| `invites` | 邀请码、使用状态与使用者标识 |
| `registration` | 是否强制邀请码注册 |
| `incognito` | 全局和所有者级无痕开关 |
| `sharedAccountMode` | 共享账号轮询开关 |
| `systemSettings` | 验证码、输入上限与全局实验设置 |
| `chainOfThoughtOverride` | 所有者级思维链覆写开关 |
| `toolParsingMode` | 所有者级工具解析模式开关 |

空数据库的概念结构：

```json
{
  "accounts": [],
  "apiKeys": [],
  "chainOfThoughtOverride": { "owners": {} },
  "toolParsingMode": { "owners": {} },
  "incognito": { "globalEnabled": false, "owners": {} },
  "invites": [],
  "registration": { "inviteRequired": false },
  "sessions": [],
  "sharedAccountMode": { "enabled": false },
  "systemSettings": {
    "captcha": {},
    "inputContentLimit": 160000
  },
  "users": []
}
```

实际默认输入上限可受环境变量影响。

## 敏感性

把整个 `data/app.json` 视为秘密数据库。即使 `PERSIST_ACCOUNT_CREDENTIALS=false`，其中仍可能存在：

- 可用的 DeepSeek 上游 token；
- 本地登录会话 ID；
- YesCaptcha 密钥；
- 账号和用户的脱敏但仍可关联标识；
- 稳定的设备 ID、DID、浏览器与硬件档案；
- 邀请码；
- API Key 哈希和局部预览。

设置 `PERSIST_ACCOUNT_CREDENTIALS=true` 后，还会保存 DeepSeek 原始登录名和密码，风险显著增加。

## 读写与迁移行为

`src/storage/store.js` 每次读取都会：

1. 解析整个 JSON 文件；
2. 补齐缺失分区与默认值；
3. 规范化布尔值、限制值和账号档案；
4. 移除旧版 API Key 明文字段；
5. 在禁用凭据持久化时清空旧账号密码并掩码登录标识；
6. 如果规范化结果不同，立即重写文件。

写入为同步整文件覆盖，没有临时文件交换、文件锁、事务日志或跨进程协调。因此：

- 只应运行一个写入该文件的进程；
- 不应把同一文件放在多个实例共享的网络盘上；
- 备份时最好先停服务；
- 手工编辑前应先备份，并保证 JSON 完整有效。

## 仅内存数据

以下数据不会写入 `app.json`，重启即清空：

- 最近最多 500 条请求日志；
- 当前并发计数和一分钟请求时间窗；
- 账号轮询游标；
- 正在进行的请求、SSE 恢复、重试和预取状态。

请求日志中的错误文本会脱敏，但所有者 ID、账号 ID、模型、路径、状态和耗时仍会显示在管理台。

## 备份

推荐流程：

1. 停止服务，避免备份过程中写入。
2. 复制 `data/app.json` 到受访问控制、加密的备份位置。
3. 单独安全保存 `.env`；不要把它和数据库放进普通源码归档。
4. 记录代码版本，因为读取旧数据库时可能触发迁移。

PowerShell 示例：

```powershell
New-Item -ItemType Directory -Force .local-backup
Copy-Item data/app.json .local-backup/app.json
```

`.local-backup/` 不是当前默认忽略项。若在项目目录使用该示例，应把它加入本地 Git 排除文件 `.git/info/exclude`，或改用项目外备份目录。

## 恢复

1. 停止服务。
2. 确认目标代码版本能够读取备份格式。
3. 把备份复制为 `data/app.json`。
4. 限制文件权限，只允许服务账号读取。
5. 启动并检查 `/api/me`、用户登录、账号状态和 Key 调用。

首次读取可能迁移并重写备份内容。需要保留原件时，应从副本恢复。

## 完整重置

完整重置会删除所有本地用户、会话、账号 token、API Key、邀请码和设置。

1. 停止服务。
2. 删除 `data/app.json`。
3. 如需同时清除本地配置，再删除 `.env`。
4. 重新启动；系统会在首次状态读取时建立空数据库。

PowerShell：

```powershell
Remove-Item -LiteralPath data/app.json -Force
```

Bash：

```bash
rm -- data/app.json
```

> [!CAUTION]
> 该操作不可通过 Git 恢复，因为数据库从不被跟踪。删除前确认是否需要加密备份。

重置后的注册策略恢复为“不要求邀请码”。如果服务可被其他人访问，应先配置管理员与网络访问控制，再开放服务。

## 局部删除

- 删除 API Key：只撤销该 Key。
- 删除账号：移除账号记录；应同时检查绑定到该账号的 Key 是否仍有业务意义。
- 删除用户：会级联清理其账号、API Key、会话和所有者级开关。
- 禁用用户：删除该用户现有会话，但保留其数据。
- 退出登录：只删除当前本地会话。
- 无痕模式：只在上游生成确认完整后删除对应 DeepSeek 聊天会话，不会清空本地账号或 Key。

## 仓库清洁检查

提交前建议执行：

```bash
git status --short
git ls-files data
git check-ignore -v .env data/app.json output .playwright-cli
```

预期只有 `data/.gitkeep` 被跟踪；`.env`、数据库和输出目录应命中 `.gitignore`。
