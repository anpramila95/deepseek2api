# 开发指南

## 本地开发

项目使用 ECMAScript Modules 和 Node.js 原生 API，无编译步骤和第三方运行时依赖。

```bash
npm start
npm test
```

修改前端文件后刷新浏览器即可。HTML、CSS 和 JavaScript 静态资源使用保守缓存策略，便于本地迭代。

## 目录职责

| 目录 | 约定 |
| --- | --- |
| `public/` | 浏览器模块、样式和静态图片；不得嵌入服务端密钥 |
| `src/routes/` | URL 匹配、认证边界、输入读取和 HTTP 响应 |
| `src/services/` | 可测试的领域逻辑与上游集成 |
| `src/storage/` | 默认状态、规范化和持久化 |
| `src/utils/` | 无领域所有权的通用工具 |
| `test/` | `node:test` 测试；有状态测试必须隔离临时目录 |
| `docs/` | 面向使用者和维护者的长期文档 |

## 测试

当前测试覆盖：

- 隐私脱敏与敏感错误清理。
- 旧状态迁移和明文凭据移除。
- API Key 使用统计与路由计数。
- 客户端档案、设备 ID 与协议分类。
- OpenAI 工具提示、专家提示词和实验开关。
- 验证码/系统设置与关键 UI 回归。

涉及状态的测试应使用 `mkdtempSync(tmpdir())` 创建隔离工作目录，并在 `finally` 中清理。测试不得读写仓库中的 `data/app.json`。

## 改动路由

1. 在对应 `src/routes/*` 文件中保持认证边界清晰。
2. 把业务逻辑放入服务层，路由只负责协议适配。
3. 对外错误必须通过 `sendError` 或等价脱敏路径返回。
4. 新增代理路径时同时更新 `src/config.js` 白名单和 `deepseek-protocol.js` 路由分组。
5. 更新 `docs/api-reference.md` 并添加成功、鉴权失败和非法输入测试。

## 改动存储结构

1. 在 `defaultState()` 中定义新字段。
2. 在规范化函数中为旧文件提供安全默认值。
3. 避免持久化能由其他字段推导出的明文秘密。
4. 添加迁移测试，至少连续读取两次并验证结果幂等。
5. 更新架构、安全、配置或运维文档。

## 改动上游协议

- 所有上游路径必须通过 `resolveDeepseekApiPath` 处理版本前缀。
- 每个账号复用自己的客户端档案，单次请求生成新的 request ID 和 trace ID。
- 只转发必要请求头；响应不得向浏览器泄露上游 Cookie。
- 对认证、PoW、验证码、限流和普通错误分别分类。
- 上游响应样本可能包含个人信息或 token，不得提交真实 HAR、日志或 payload；测试使用最小化的合成 fixture。

## 提交前检查

```bash
npm test
git diff --check
git status --short --ignored
```

然后确认：

- `data/` 只有 `.gitkeep` 被跟踪。
- 没有 `.env`、数据库、日志、HAR、截图、Playwright 产物或临时目录。
- 文档与实际环境变量、路由和安全默认值一致。
- 新测试不依赖真实网络、账号或个人信息。
- 提交信息准确描述本次变更，不包含凭据或内部地址。
