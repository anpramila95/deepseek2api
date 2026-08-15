import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";

const envFile = join(process.cwd(), ".env");

if (existsSync(envFile)) {
  loadEnvFile();
}

const dataDirectory = join(process.cwd(), "data");

mkdirSync(dataDirectory, { recursive: true });

const adminUsername = process.env.APP_ADMIN_USERNAME ?? "";
const adminPassword = process.env.APP_ADMIN_PASSWORD ?? "";
const deepseekApiVersion = normalizeDeepseekApiVersion(process.env.DEEPSEEK_API_VERSION ?? "v0");
const deepseekApiPrefix = `/api/${deepseekApiVersion}`;
const deepseekBaseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://chat.deepseek.com";

function parseCsv(value, fallback = []) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const values = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return values.length ? values : fallback;
}

function parseJson(value, fallback) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function parseNonNegativeNumber(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(max, parsed));
}

const powProtectedRouteSuffixes = Object.freeze([
  "/chat/completion",
  "/file/upload_file"
]);

const allowedProxyRouteSuffixes = Object.freeze([
  "/chat/completion",
  "/chat/continue",
  "/chat/create_pow_challenge",
  "/chat/edit_message",
  "/chat/history_messages",
  "/chat/message_feedback",
  "/chat/regenerate",
  "/chat/resume_stream",
  "/chat/stop_stream",
  "/chat_session/create",
  "/chat_session/delete",
  "/chat_session/delete_all",
  "/chat_session/fetch_page",
  "/chat_session/update_pinned",
  "/chat_session/update_title",
  "/client/settings",
  "/client/settings/report",
  "/client/span",
  "/client/wechat_js_sdk_signature",
  "/download_export_history",
  "/export_all",
  "/file/fetch_files",
  "/file/fork_file_task",
  "/file/preview",
  "/file/upload_file",
  "/index/prepare",
  "/index/query",
  "/share/content",
  "/share/create",
  "/share/delete",
  "/share/fork",
  "/share/list",
  "/users/current",
  "/users/logout_all_sessions",
  "/users/set_birthday",
  "/users/settings",
  "/users/update_settings"
]);

function normalizeDeepseekApiVersion(value) {
  const version = String(value || "v0").trim().toLowerCase();
  const normalized = version.startsWith("v") ? version : `v${version}`;

  if (!/^v\d+$/.test(normalized)) {
    throw new Error(`Invalid DEEPSEEK_API_VERSION: ${value}`);
  }

  return normalized;
}

function resolveDeepseekRouteSuffix(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const versionedMatch = /^\/api\/v\d+(\/.*)$/.exec(normalizedPath);
  return versionedMatch ? versionedMatch[1] : normalizedPath;
}

function buildDeepseekApiPath(prefix, path) {
  return `${prefix}${resolveDeepseekRouteSuffix(path)}`;
}

export function resolveDeepseekApiPath(path) {
  return buildDeepseekApiPath(config.deepseekApiPrefix, path);
}

export const config = Object.freeze({
  port: Number(process.env.PORT ?? 3000),
  dataFile: join(dataDirectory, "app.json"),
  sessionCookieName: "ds_reverse_session",
  sessionTtlMs: 1000 * 60 * 60 * 24 * 7,
  requestBodyLimitBytes: 110 * 1024 * 1024,
  deepseekBaseUrl,
  deepseekApiVersion,
  deepseekApiPrefix,
  powWasmUrl:
    process.env.DEEPSEEK_POW_WASM_URL ??
    "https://fe-static.deepseek.com/chat/static/sha3_wasm_bg.7b9ca65ddd.wasm",
  powPrefetchCount: Number(process.env.DEEPSEEK_POW_PREFETCH_COUNT ?? 1),
  powProtectedPaths: new Set(
    powProtectedRouteSuffixes.map((path) => buildDeepseekApiPath(deepseekApiPrefix, path))
  ),
  allowedProxyPaths: new Set(
    allowedProxyRouteSuffixes.map((path) => buildDeepseekApiPath(deepseekApiPrefix, path))
  ),
  deepseekHeaders: Object.freeze({
    clientBundleId: process.env.DEEPSEEK_CLIENT_BUNDLE_ID ?? "com.deepseek.chat",
    clientVersion: process.env.DEEPSEEK_CLIENT_VERSION ?? "2.2.0",
    clientPlatform: process.env.DEEPSEEK_CLIENT_PLATFORM ?? "web",
    locale: process.env.DEEPSEEK_CLIENT_LOCALE ?? "zh_CN",
    timezoneOffset: process.env.DEEPSEEK_TIMEZONE_OFFSET ?? "28800",
    areaCode: process.env.DEEPSEEK_DEFAULT_AREA_CODE ?? "+86",
    userAgent: process.env.DEEPSEEK_USER_AGENT ?? "",
    secChUa: process.env.DEEPSEEK_SEC_CH_UA ?? "",
    secChUaMobile: process.env.DEEPSEEK_SEC_CH_UA_MOBILE ?? "",
    secChUaPlatform: process.env.DEEPSEEK_SEC_CH_UA_PLATFORM ?? ""
  }),
  // Profile values are configurable pools.  A profile is generated once per
  // bound account and then persisted, so requests stay internally coherent
  // while new local fixtures can select a different environment without
  // changing source code.
  deepseekProfile: Object.freeze({
    platforms: parseCsv(process.env.DEEPSEEK_PROFILE_PLATFORMS, ["Windows", "macOS", "Linux"]),
    chromeVersions: parseCsv(process.env.DEEPSEEK_PROFILE_CHROME_VERSIONS, ["126", "127", "128", "129", "130"]),
    sources: parseCsv(process.env.DEEPSEEK_PROFILE_SOURCES, ["chat-web", "chat-web-v2", "chat-web-v3"]),
    screenSizes: parseJson(process.env.DEEPSEEK_PROFILE_SCREEN_SIZES, [
      [1920, 1080],
      [1536, 864],
      [1440, 900],
      [1366, 768],
      [2560, 1440]
    ]),
    gpuVendors: parseCsv(process.env.DEEPSEEK_PROFILE_GPU_VENDORS, ["Generic GPU Vendor"]),
    gpuRenderers: parseCsv(process.env.DEEPSEEK_PROFILE_GPU_RENDERERS, ["Generic GPU Renderer"]),
    hardwareConcurrency: parseCsv(process.env.DEEPSEEK_PROFILE_HARDWARE_CONCURRENCY, ["4", "6", "8", "12", "16"]),
    deviceMemory: parseCsv(process.env.DEEPSEEK_PROFILE_DEVICE_MEMORY, ["4", "8", "16"])
  }),
  deepseekRisk: Object.freeze({
    maxRetries: parseNonNegativeNumber(process.env.DEEPSEEK_RISK_MAX_RETRIES, 2, 20),
    baseDelayMs: parseNonNegativeNumber(process.env.DEEPSEEK_RISK_BASE_DELAY_MS, 750, 3_600_000),
    jitterMs: parseNonNegativeNumber(process.env.DEEPSEEK_RISK_JITTER_MS, 500, 3_600_000)
  }),
  chainOfThoughtOverrideEnabled: (
    process.env.CHAIN_OF_THOUGHT_OVERRIDE_ENABLED
    ?? process.env.EXPERT_PROMPT_SUFFIX_ENABLED
  ) === "true",
  shumei: Object.freeze({
    organization:
      process.env.SHUMEI_ORGANIZATION
      ?? process.env.SUMEI_ORGANIZATION
      ?? "P9usCUBauxft8eAmUXaZ",
    captchaBaseUrl:
      process.env.SHUMEI_CAPTCHA_BASE_URL
      ?? process.env.SUMEI_CAPTCHA_BASE_URL
      ?? "https://captcha1.fengkongcloud.cn",
    captchaAssetBaseUrl:
      process.env.SHUMEI_CAPTCHA_ASSET_BASE_URL
      ?? process.env.SUMEI_CAPTCHA_ASSET_BASE_URL
      ?? "https://castatic.fengkongcloud.cn"
  }),
  captcha: Object.freeze({
    yescaptchaEndpoint: process.env.YESCAPTCHA_ENDPOINT ?? "https://api.yescaptcha.com",
    yescaptchaKey: process.env.YESCAPTCHA_KEY ?? "",
    autoSolveEnabled: process.env.CAPTCHA_AUTO_SOLVE === "true",
    visionFallbackEnabled: process.env.CAPTCHA_VISION_FALLBACK !== "false",
    maxRetries: Number(process.env.CAPTCHA_MAX_RETRIES ?? 3),
    cooldownMs: Number(process.env.CAPTCHA_COOLDOWN_MS ?? 60_000)
  }),
  security: Object.freeze({
    persistAccountCredentials: process.env.PERSIST_ACCOUNT_CREDENTIALS === "true"
  }),
  admin: Object.freeze({
    enabled: Boolean(adminUsername && adminPassword),
    username: adminUsername,
    password: adminPassword
  })
});
