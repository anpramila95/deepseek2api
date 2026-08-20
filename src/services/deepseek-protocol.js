import { randomUUID } from "node:crypto";

import { config, resolveDeepseekApiPath } from "../config.js";
import {
  createDeepseekClientHeaders,
  resolveDeepseekClientProfile
} from "./deepseek-device.js";

const DEFAULT_RETRY_AFTER_MS = 1_000;

export const DEEPSEEK_PROTOCOL_ROUTE_GROUPS = Object.freeze({
  chat: Object.freeze([
    "/chat/completion",
    "/chat/continue",
    "/chat/create_pow_challenge",
    "/chat/edit_message",
    "/chat/history_messages",
    "/chat/message_feedback",
    "/chat/regenerate",
    "/chat/resume_stream",
    "/chat/stop_stream"
  ]),
  sessions: Object.freeze([
    "/chat_session/create",
    "/chat_session/delete",
    "/chat_session/delete_all",
    "/chat_session/fetch_page",
    "/chat_session/update_pinned",
    "/chat_session/update_title"
  ]),
  client: Object.freeze([
    "/client/settings",
    "/client/settings/report",
    "/client/span",
    "/client/wechat_js_sdk_signature"
  ]),
  files: Object.freeze([
    "/file/fetch_files",
    "/file/fork_file_task",
    "/file/preview",
    "/file/upload_file"
  ]),
  index: Object.freeze(["/index/prepare", "/index/query"]),
  users: Object.freeze([
    "/users/login",
    "/users/logout",
    "/users/current",
    "/users/logout_all_sessions",
    "/users/set_birthday",
    "/users/settings",
    "/users/update_settings"
  ]),
  sharing: Object.freeze([
    "/share/content",
    "/share/create",
    "/share/delete",
    "/share/fork",
    "/share/list"
  ])
});

function flattenRouteGroups(groups) {
  return [...new Set(Object.values(groups).flat())];
}

function parseRetryAfter(value) {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1_000));
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

export function computeRiskBackoffMs(attempt = 0, randomValue = Math.random()) {
  const safeAttempt = Math.max(0, Math.min(config.deepseekRisk.maxRetries, Math.trunc(Number(attempt) || 0)));
  const exponential = config.deepseekRisk.baseDelayMs * (2 ** safeAttempt);
  const jitter = Math.max(0, Math.min(1, Number(randomValue) || 0)) * config.deepseekRisk.jitterMs;
  return Math.round(exponential + jitter);
}

export function resolveRetryAfterMs(headers, fallback = DEFAULT_RETRY_AFTER_MS) {
  const value = headers?.get?.("retry-after")
    ?? headers?.["retry-after"]
    ?? headers?.["Retry-After"];
  return parseRetryAfter(value) ?? fallback;
}

export function createProtocolRequestContext(account, path, { method = "GET" } = {}) {
  const profile = resolveDeepseekClientProfile(account ?? {});
  const origin = new URL(config.deepseekBaseUrl).origin;
  const requestId = randomUUID();
  const traceId = randomUUID();
  const normalizedMethod = String(method).toUpperCase();
  const includesOrigin = normalizedMethod !== "GET" && normalizedMethod !== "HEAD";

  return {
    profile,
    requestId,
    traceId,
    targetPath: resolveDeepseekApiPath(path),
    headers: createDeepseekClientHeaders(profile, {
      accept: "application/json, text/plain, */*",
      priority: "u=1, i",
      referer: `${origin}/`,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      ...(includesOrigin ? { origin } : {})
    })
  };
}

export function classifyProtocolResponse({ status, payload, headers } = {}) {
  const text = JSON.stringify(payload ?? "").toLowerCase();
  const bizCode = payload?.data?.biz_code ?? payload?.code;
  const retryAfterMs = resolveRetryAfterMs(headers, computeRiskBackoffMs(0));
  const hasCaptcha = /captcha|hcaptcha|shumei|验证码|数美|风控|verification/.test(text);
  const hasPow = /pow|proof.?of.?work|challenge/.test(text);

  if (hasCaptcha) {
    return { kind: "captcha", retryAfterMs };
  }

  if (hasPow) {
    return { kind: "pow", retryAfterMs };
  }

  if (status === 401 || status === 403 || bizCode === 40002 || bizCode === 40003) {
    return { kind: "auth", retryAfterMs };
  }

  if (status === 429 || status === 503 || /rate.?limit|too many|频繁/.test(text)) {
    return { kind: "rate_limit", retryAfterMs };
  }

  return { kind: status >= 400 ? "error" : "ok", retryAfterMs: 0 };
}

export function getProtocolManifest() {
  const configuredPaths = [...config.allowedProxyPaths]
    .map((path) => path.replace(config.deepseekApiPrefix, ""))
    .sort();
  const knownPaths = flattenRouteGroups(DEEPSEEK_PROTOCOL_ROUTE_GROUPS).sort();

  return {
    apiVersion: config.deepseekApiVersion,
    baseUrl: config.deepseekBaseUrl,
    powProtectedPaths: [...config.powProtectedPaths].sort(),
    riskPolicy: config.deepseekRisk,
    paths: configuredPaths,
    knownPaths,
    groups: DEEPSEEK_PROTOCOL_ROUTE_GROUPS
  };
}
