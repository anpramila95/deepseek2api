# 开发指南

## 开发环境

要求 Node.js 20.12.0 或更高版本。项目使用 ES Modules、Node.js 原生 API 和浏览器原生模块，没有编译或打包步骤。

常用命令：

```bash
npm start
npm test
```

当前 `package.json` 没有 lint、format、build 或 typecheck 脚本。提交前需要额外执行语法与人工检查。

## 目录职责

```text
src/config.js            启动配置、上游路径和代理白名单
src/server.js            HTTP 入口与顶层错误处理
src/routes/              协议边界和认证分发
src/services/            业务规则与上游交互
src/storage/store.js     默认状态、迁移与 JSON 读写
src/utils/               HTTP、SSE、隐私和 ID 工具
public/                  原生浏览器管理台
test/                    node:test 测试
docs/                    用户、运维和开发文档
```

更完整的组件关系见[架构说明](architecture.md)。

## 设计约定

### 路由保持薄层

路由负责：

- 认证与路径匹配；
- 读取和解析请求；
- 调用服务层；
- 将已知错误映射为状态码；
- 写入响应。

账号、存储、重试、隐私或协议规则应放在服务层，便于单元测试。

### 所有权必须显式

涉及账号、Key、日志或设置时传递 `ownerId`，不要依赖前端隐藏。普通用户查询必须在服务端按所有者过滤；管理员特权应在 API 路由统一判断。

### 上游路径必须进入白名单

新增代理路径时：

1. 在 `src/config.js` 的 `allowedProxyRouteSuffixes` 中明确添加；
2. 判断是否需要 PoW，并更新 `powProtectedRouteSuffixes`；
3. 评估方法、请求体、账号范围和响应头；
4. 更新 [API 参考](api-reference.md)与协议测试。

不要实现任意路径透传。

### 错误必须脱敏

上游错误进入日志或响应前应使用 `redactSensitiveText` 或 `createSafeUpstreamError`。不要记录完整请求头、Cookie、token、登录凭据、验证码密钥、设备标识或上游响应正文。

### 完成流以协议状态为准

TCP 结束不等于消息完成。修改 completion 逻辑时保持以下不变量：

- `close` 前断流尝试 `resume_stream`；
- `INCOMPLETE` 尝试 `continue`；
- 多次快照做重叠去重；
- 达到上限返回错误；
- 只有 `completed === true` 才允许无痕删除。

### 状态迁移应幂等

`readStore()` 可能在每次请求被调用。新增状态字段时：

- 为缺失字段提供默认值；
- 接受合理的旧字段别名；
- 移除不再允许的敏感字段；
- 保证连续两次规范化结果一致；
- 增加隔离临时目录中的迁移测试。

## 测试

测试使用 `node:test` 与 `node:assert/strict`：

```bash
npm test
```

当前测试覆盖的主要风险包括：

- API Key 使用量和账号轮询；
- 账号绑定隐私确认；
- 设备档案一致性与协议头；
- PoW 过期和上游错误分类；
- 超长输入分段；
- SSE 断流恢复、继续、去重和无痕清理；
- 频繁发送账号切换；
- Reasoner 结构化输出；
- 工具提示、解析、流式 sieve 和工具解析模式；
- 存储迁移、系统设置和隐私脱敏；
- 管理台关键回归。

涉及持久状态的测试应使用 `mkdtempSync()` 创建系统临时工作区，并在 `finally` 中清理。不得依赖或修改项目根目录的真实 `data/app.json`。

测试中使用保留域名、虚构 token 和确定性 ID。不要把真实账号、Cookie、设备档案或响应快照放入 fixture。

## 语法检查

可对源码和测试执行 Node 语法检查：

```powershell
Get-ChildItem src,public,test -Recurse -Filter *.js |
  ForEach-Object { node --check $_.FullName }
```

Bash：

```bash
find src public test -name '*.js' -print0 | xargs -0 -n1 node --check
```

语法检查不能替代 `npm test`。

## 扩展模型

模型定义在两个位置：

- 服务端：`src/services/openai-request.js`
- 浏览器端：`public/chat-models.js`

新增或修改模型时必须同步：

- ID、上游 `modelType`；
- 思考、搜索、Vision、附件能力；
- OpenAI 输入校验；
- UI 选择与提示；
- README、API 文档和测试。

## 扩展配置

新增环境变量时：

1. 在 `src/config.js` 解析、约束并提供安全默认值；
2. 在 `.env.example` 添加无秘密示例；
3. 在[配置参考](configuration.md)记录默认值、格式、范围和重启要求；
4. 若可由管理台覆盖，明确环境默认值与持久化值的优先级；
5. 为无效输入和旧字段迁移增加测试。

## 修改前端

`public/` 没有构建步骤。浏览器直接加载脚本，因此：

- 保持模块依赖顺序和全局导出兼容；
- 避免引入需要 bundler 的包；
- 更新 CSS/JS 后检查桌面和窄屏布局；
- 关注静态缓存头和 CDN 缓存；
- 任何第三方脚本都会扩大供应链与隐私边界。

UI 回归测试目前以源码断言为主，不能替代真实浏览器手工验证。

## 文档同步矩阵

| 改动 | 至少更新 |
| --- | --- |
| 环境变量或默认值 | `.env.example`、`configuration.md` |
| API 路径或请求体 | `api-reference.md` |
| 模型能力 | README、`api-reference.md` |
| 存储字段或迁移 | `data-storage.md`、`architecture.md` |
| 安全边界 | `security-and-privacy.md`、`operations.md` |
| 启动要求或脚本 | README、`getting-started.md`、本文件 |

## 提交前检查

```bash
npm test
git diff --check
git status --short
git ls-files data
git check-ignore -v .env data/app.json output .playwright-cli
```

并人工确认：

- 没有真实凭据、个人信息、数据库、日志、截图或临时文件；
- 新逻辑有对应测试；
- 路由和存储仍执行所有权检查；
- 错误信息经过脱敏；
- README 与各专题文档中的链接有效；
- 代理白名单没有意外扩大。
