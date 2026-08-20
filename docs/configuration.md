# 配置参考

服务启动时读取进程环境变量；工作目录存在 `.env` 时，也会通过 Node.js `loadEnvFile()` 加载。建议从 `.env.example` 复制本地配置，并确保 `.env` 始终不进入版本控制。

## 基础配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 监听端口 |
| `APP_ADMIN_USERNAME` | 空 | 管理员用户名；必须与密码同时非空才启用管理员登录 |
| `APP_ADMIN_PASSWORD` | 空 | 管理员密码；源码中按字符串直接比较 |

服务当前没有监听地址变量，`server.listen(PORT)` 可能绑定全部网络接口。网络范围应由主机防火墙或反向代理控制。

## DeepSeek 上游与 PoW

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_BASE_URL` | `https://chat.deepseek.com` | DeepSeek Web 根地址 |
| `DEEPSEEK_API_VERSION` | `v0` | 上游 API 版本；接受 `0` 或 `v0` 形式，只允许数字版本 |
| `DEEPSEEK_POW_WASM_URL` | 源码内官方静态地址 | PoW WASM 资源地址 |
| `DEEPSEEK_POW_PREFETCH_COUNT` | `1` | PoW 预取数量 |

PoW 默认保护 `/chat/completion` 与 `/file/upload_file`。代理白名单不可通过环境变量扩大。

## DeepSeek 客户端请求头

| 变量 | 默认值 |
| --- | --- |
| `DEEPSEEK_CLIENT_BUNDLE_ID` | `com.deepseek.chat` |
| `DEEPSEEK_CLIENT_VERSION` | `2.3.0` |
| `DEEPSEEK_CLIENT_PLATFORM` | `web` |
| `DEEPSEEK_CLIENT_LOCALE` | 空 |
| `DEEPSEEK_TIMEZONE_OFFSET` | 空 |
| `DEEPSEEK_DEFAULT_AREA_CODE` | `+86` |
| `DEEPSEEK_USER_AGENT` | 空 |
| `DEEPSEEK_SEC_CH_UA` | 空 |
| `DEEPSEEK_SEC_CH_UA_MOBILE` | 空 |
| `DEEPSEEK_SEC_CH_UA_PLATFORM` | 空 |

没有显式覆盖时，账号客户端档案会补齐连贯的 User-Agent、Client Hints、语言、屏幕和 GPU 信息。

## 模拟客户端档案池

每个新绑定账号从配置池生成一次档案并持久化，后续请求稳定复用。更改环境变量不会自动轮换已有账号档案。

| 变量 | 格式 | 默认值摘要 |
| --- | --- | --- |
| `DEEPSEEK_PROFILE_PLATFORMS` | 逗号分隔 | `Windows,macOS,Linux` |
| `DEEPSEEK_PROFILE_CHROME_VERSIONS` | 逗号分隔 | `149,150,151` |
| `DEEPSEEK_PROFILE_SOURCES` | 逗号分隔 | `chat-web` |
| `DEEPSEEK_PROFILE_LOCALE_PROFILES` | JSON 数组 | 中文浏览器区域档案 |
| `DEEPSEEK_PROFILE_SCREEN_SIZES` | JSON 二维数组 | 5 种常见屏幕尺寸 |
| `DEEPSEEK_PROFILE_GPU_PROFILES` | JSON 数组 | Windows、macOS、Linux 的连贯 GPU 档案 |
| `DEEPSEEK_PROFILE_GPU_VENDORS` | 逗号分隔 | 空；旧版独立覆盖池 |
| `DEEPSEEK_PROFILE_GPU_RENDERERS` | 逗号分隔 | 空；旧版独立覆盖池 |
| `DEEPSEEK_PROFILE_HARDWARE_CONCURRENCY` | 逗号分隔 | `4,6,8,12,16` |
| `DEEPSEEK_PROFILE_DEVICE_MEMORY` | 逗号分隔 | `4,8,16` |

JSON 值示例：

```env
DEEPSEEK_PROFILE_SCREEN_SIZES=[[1920,1080],[1536,864]]
DEEPSEEK_PROFILE_LOCALE_PROFILES=[{"locale":"zh_CN","browserLocale":"zh-CN","acceptLanguage":"zh-CN,zh;q=0.9","timezoneOffset":"28800"}]
```

无效 JSON 会静默回退到默认值；空的逗号分隔值也会回退。

## 风控重试与流恢复

| 变量 | 默认值 | 有效范围/说明 |
| --- | --- | --- |
| `DEEPSEEK_RISK_MAX_RETRIES` | `2` | `0` 到 `20` |
| `DEEPSEEK_RISK_BASE_DELAY_MS` | `750` | `0` 到 `3600000` 毫秒 |
| `DEEPSEEK_RISK_JITTER_MS` | `500` | `0` 到 `3600000` 毫秒 |
| `DEEPSEEK_STREAM_MAX_RESUMES` | `12` | `0` 到 `100` |
| `DEEPSEEK_STREAM_MAX_CONTINUES` | `12` | `0` 到 `100` |
| `DEEPSEEK_STREAM_RESUME_DELAY_MS` | `250` | `0` 到 `3600000` 毫秒 |
| `DEEPSEEK_STREAM_CONTINUE_DELAY_MS` | `250` | `0` 到 `3600000` 毫秒 |
| `DEEPSEEK_INPUT_CONTENT_LIMIT` | `160000` | `1` 到 `10000000` 字符；环境解析阶段要求正整数 |

`resume` 用于上游传输在协议 `close` 前中断；`continue` 用于上游消息状态仍为 `INCOMPLETE`。达到上限会以错误结束，不会把未完成结果标记为成功。

## 实验与提示词

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CHAIN_OF_THOUGHT_OVERRIDE_ENABLED` | `false` | 全局思维链覆写默认值 |
| `EXPERT_PROMPT_SUFFIX_ENABLED` | 未设置 | 旧版兼容别名，仅在新变量未设置时生效 |

管理员在管理台保存的全局设置会写入 `data/app.json`，并优先于上述默认值。

## 数美与验证码

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SHUMEI_ORGANIZATION` | 源码内 Web 组织标识 | 数美组织标识 |
| `SHUMEI_CAPTCHA_BASE_URL` | `https://captcha1.fengkongcloud.cn` | 验证接口根地址 |
| `SHUMEI_CAPTCHA_ASSET_BASE_URL` | `https://castatic.fengkongcloud.cn` | 验证码资源根地址 |
| `YESCAPTCHA_ENDPOINT` | `https://api.yescaptcha.com` | YesCaptcha 服务地址 |
| `YESCAPTCHA_KEY` | 空 | YesCaptcha 密钥 |
| `CAPTCHA_AUTO_SOLVE` | `false` | 仅严格等于 `true` 时开启自动处理 |
| `CAPTCHA_VISION_FALLBACK` | `true` | 仅严格等于 `false` 时关闭视觉回退 |
| `CAPTCHA_MAX_RETRIES` | `3` | 自动处理重试次数；管理台持久化值限制为 `1` 到 `20` |
| `CAPTCHA_COOLDOWN_MS` | `60000` | 冷却时间；管理台持久化值限制为 `0` 到 `3600000` 毫秒 |

兼容旧拼写：`SUMEI_ORGANIZATION`、`SUMEI_CAPTCHA_BASE_URL`、`SUMEI_CAPTCHA_ASSET_BASE_URL`。新拼写优先。

## 凭据持久化

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PERSIST_ACCOUNT_CREDENTIALS` | `false` | 是否保存 DeepSeek 原始登录名和密码 |

即使保持默认值，`data/app.json` 仍会保存上游 token、设备档案、会话和其他敏感状态。详见[数据存储与清理](data-storage.md)。

## 管理台持久化设置

管理员可通过管理台或 `POST /api/admin/system-settings` 保存：

- `captcha.yescaptchaEndpoint`
- `captcha.yescaptchaKey`
- `captcha.autoSolveEnabled`
- `captcha.visionFallbackEnabled`
- `captcha.visionFallbackAccountId`
- `captcha.maxRetries`
- `captcha.cooldownMs`
- `inputContentLimit`
- `chainOfThoughtOverrideEnabled`
- `toolParsingModeEnabled`

这些值保存在 `data/app.json`。公开管理载荷只返回 YesCaptcha 密钥是否存在及尾部掩码，内部调用仍可读取完整密钥。

## 配置变更生效方式

- `.env`：重启进程后生效。
- 管理台系统设置：写入后对后续请求生效。
- 客户端档案池：只影响此后新绑定或缺少档案的账号。
- `DEEPSEEK_API_VERSION`：重启后同时改变上游路径前缀、代理白名单和 PoW 保护路径。
