# 配置参考

## 配置加载

服务启动时读取项目根目录的 `.env`。环境变量优先于代码默认值；部分验证码和实验功能可由管理员在管理台覆盖，管理台值保存在 `data/app.json`。

布尔值通常使用小写 `true` / `false`。数组池使用逗号分隔；屏幕尺寸使用 JSON 数组。

## 基础配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 监听端口 |
| `APP_ADMIN_USERNAME` | 空 | 管理员用户名；用户名和密码同时非空才启用管理员登录 |
| `APP_ADMIN_PASSWORD` | 空 | 管理员密码 |
| `DEEPSEEK_BASE_URL` | `https://chat.deepseek.com` | DeepSeek Web 上游根地址 |
| `DEEPSEEK_API_VERSION` | `v0` | 上游接口版本，接受 `v0`、`v1` 等格式 |
| `DEEPSEEK_POW_WASM_URL` | 内置官方静态地址 | PoW 求解使用的 wasm |
| `DEEPSEEK_POW_PREFETCH_COUNT` | `1` | PoW 挑战预取数量；`0` 表示关闭预取 |

## 客户端请求头

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_CLIENT_BUNDLE_ID` | `com.deepseek.chat` | 客户端 bundle 标识 |
| `DEEPSEEK_CLIENT_VERSION` | `2.2.0` | 客户端版本 |
| `DEEPSEEK_CLIENT_PLATFORM` | `web` | 客户端平台 |
| `DEEPSEEK_CLIENT_LOCALE` | `zh_CN` | 语言标识 |
| `DEEPSEEK_TIMEZONE_OFFSET` | `28800` | 时区偏移秒数 |
| `DEEPSEEK_DEFAULT_AREA_CODE` | `+86` | 默认区号 |
| `DEEPSEEK_USER_AGENT` | 自动生成 | 可选 User-Agent 覆盖值 |
| `DEEPSEEK_SEC_CH_UA` | 自动生成 | 可选 `sec-ch-ua` 覆盖值 |
| `DEEPSEEK_SEC_CH_UA_MOBILE` | `?0` | `sec-ch-ua-mobile` |
| `DEEPSEEK_SEC_CH_UA_PLATFORM` | 自动生成 | 可选 `sec-ch-ua-platform` 覆盖值 |

## 客户端档案池

每个绑定账号会生成并持久化独立档案。已持久化的档案在后续请求中复用，避免同一账号的环境字段漂移。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_PROFILE_PLATFORMS` | `Windows,macOS,Linux` | 宿主平台池 |
| `DEEPSEEK_PROFILE_CHROME_VERSIONS` | `126,127,128,129,130` | Chrome 主版本池 |
| `DEEPSEEK_PROFILE_SOURCES` | `chat-web,chat-web-v2,chat-web-v3` | 客户端来源池 |
| `DEEPSEEK_PROFILE_SCREEN_SIZES` | 内置常见尺寸 | JSON 屏幕尺寸数组，例如 `[[1920,1080],[1440,900]]` |
| `DEEPSEEK_PROFILE_GPU_VENDORS` | `Generic GPU Vendor` | GPU 厂商池 |
| `DEEPSEEK_PROFILE_GPU_RENDERERS` | `Generic GPU Renderer` | GPU 渲染器池 |
| `DEEPSEEK_PROFILE_HARDWARE_CONCURRENCY` | `4,6,8,12,16` | CPU 并发度池 |
| `DEEPSEEK_PROFILE_DEVICE_MEMORY` | `4,8,16` | 设备内存池，单位 GB |

改变档案池不会自动重建已有账号档案；如需重建，应重新绑定对应账号。

## 风控与验证码

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_RISK_MAX_RETRIES` | `2` | 退避指数允许的最大尝试序号，限制为 `0..20` |
| `DEEPSEEK_RISK_BASE_DELAY_MS` | `750` | 退避基准毫秒数 |
| `DEEPSEEK_RISK_JITTER_MS` | `500` | 随机抖动上限毫秒数 |
| `SHUMEI_ORGANIZATION` | 内置兼容值 | 数美验证组织标识 |
| `SHUMEI_CAPTCHA_BASE_URL` | `https://captcha1.fengkongcloud.cn` | 数美验证接口根地址 |
| `SHUMEI_CAPTCHA_ASSET_BASE_URL` | `https://castatic.fengkongcloud.cn` | 验证码静态资源根地址 |
| `YESCAPTCHA_ENDPOINT` | `https://api.yescaptcha.com` | YesCaptcha Endpoint |
| `YESCAPTCHA_KEY` | 空 | YesCaptcha Key |
| `CAPTCHA_AUTO_SOLVE` | `false` | 只有显式设为 `true` 才自动处理验证码 |
| `CAPTCHA_VISION_FALLBACK` | `true` | 允许备用 Vision 账号降级处理 |
| `CAPTCHA_MAX_RETRIES` | `3` | 验证码最大重试参数，限制为 `1..20` |
| `CAPTCHA_COOLDOWN_MS` | `60000` | 自动处理冷却毫秒数 |

管理台的验证码设置覆盖对应环境变量，并会保存 Endpoint、Key、开关、备用账号、重试次数和冷却时间。

## 隐私与实验功能

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PERSIST_ACCOUNT_CREDENTIALS` | `false` | 是否保存 DeepSeek 登录名明文和密码，以支持 token 自动刷新 |
| `CHAIN_OF_THOUGHT_OVERRIDE_ENABLED` | `false` | 是否全局启用实验性专家提示词后缀 |

`PERSIST_ACCOUNT_CREDENTIALS=true` 会显著提高 `data/app.json` 的敏感级别。除非确实需要自动刷新登录，否则保持关闭。

## 配置优先级

1. 管理台中已经保存的验证码/实验功能设置。
2. `.env` 或进程环境变量。
3. `src/config.js` 中的默认值。

账号客户端档案是绑定时生成的持久化数据，不会在每次启动时根据新环境变量重新生成。

## 兼容别名

为读取旧部署配置，代码仍接受 `EXPERT_PROMPT_SUFFIX_ENABLED` 作为
`CHAIN_OF_THOUGHT_OVERRIDE_ENABLED` 的后备值，并接受 `SUMEI_ORGANIZATION`、
`SUMEI_CAPTCHA_BASE_URL`、`SUMEI_CAPTCHA_ASSET_BASE_URL` 作为对应 `SHUMEI_*`
变量的后备值。新配置应只使用规范名称；兼容别名未来可能移除。
