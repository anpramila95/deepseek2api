
import { config, resolveDeepseekApiPath } from "../config.js";
import { createSafeUpstreamError, maskIdentifier } from "../utils/privacy.js";
import { saveAccount } from "./account-service.js";
import {
  createDeepseekClientHeaders,
  resolveDeepseekClientProfile,
  withResolvedDeepseekClientProfile
} from "./deepseek-device.js";
import { createProtocolRequestContext } from "./deepseek-protocol.js";
import { reportClientSettingsForAccount } from "./deepseek-settings.js";
import { solveWaf } from "./waf-solver.js";
import fs from "fs";

import { resolveProxyDispatcher } from "./proxy-dispatcher.js";
function isEmail(loginValue) {
  return String(loginValue ?? "").includes("@");
}

export function createBaseHeaders(token, extraHeaders = {}, profileSource = {}) {
  const headers = createDeepseekClientHeaders(profileSource, extraHeaders);

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  return headers;
}

function buildLoginPayload(loginValue, password, profile) {
  const normalizedLogin = String(loginValue ?? "").trim();
  const emailLogin = isEmail(normalizedLogin);
  return {
    email: emailLogin ? normalizedLogin : "",
    mobile: emailLogin ? "" : normalizedLogin,
    password: String(password ?? ""),
    area_code: emailLogin ? "" : profile.areaCode,
    device_id: profile.loginDeviceId,
    os: profile.os
  };
}

export async function loginToDeepseek({ loginValue, password, deviceId, deviceProfile, proxy }) {
  const profile = resolveDeepseekClientProfile(deviceProfile ?? { deviceId });
  const maskedUser = maskIdentifier(loginValue);
  console.error(`[DeepSeek Auth] Resolving profile (user: "${maskedUser}", deviceId: ${profile.loginDeviceId}, OS: ${profile.os})`);

  let wafCookie = "";
  try {
    const siteUrl = `${config.deepseekBaseUrl}/sign_in`;
    const ua = profile.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";
    console.error(`[DeepSeek Auth] Fetching WAF token prior to login...`);
    const { cookie } = await solveWaf(siteUrl, ua);
    if (cookie) {
      wafCookie = cookie;
      console.error(`[DeepSeek Auth] WAF token acquired successfully.`);
    }
  } catch (wafErr) {
    console.error(`[DeepSeek Auth] WAF pre-solve skipped/failed: ${wafErr.message}`);
  }

  const requestContext = createProtocolRequestContext(profile, "/users/login", { method: "POST" });
  const targetUrl = `${config.deepseekBaseUrl}${resolveDeepseekApiPath("/users/login")}`;
  console.error(`[DeepSeek Auth] Sending POST request to ${targetUrl}`);

  const extraHeaders = {
    ...requestContext.headers,
    "content-type": "application/json"
  };
  if (wafCookie) {
    extraHeaders.cookie = wafCookie;
  }

  let response = await fetch(targetUrl, {
    method: "POST",
    headers: createBaseHeaders("", extraHeaders, profile),
    body: JSON.stringify(buildLoginPayload(loginValue, password, profile)),
    dispatcher: resolveProxyDispatcher(proxy)
  });

  let wafAction = response.headers.get("x-amzn-waf-action");
  console.error(`[DeepSeek Auth] Response status: HTTP ${response.status} ${response.statusText}${wafAction ? ` (x-amzn-waf-action: ${wafAction})` : ""}`);

  let responseText = "";
  try {
    responseText = await response.text();
  } catch (err) {
    console.error(`[DeepSeek Auth] Failed to read response body:`, err);
    throw createSafeUpstreamError("DeepSeek login failed: unable to read upstream response", {
      status: response.status,
      body: ""
    });
  }

  if (response.status === 202 || wafAction === "challenge") {
    console.error(`[DeepSeek Auth] CloudFront / AWS WAF challenge encountered (HTTP ${response.status})`);
    throw createSafeUpstreamError("DeepSeek login failed: CloudFront / AWS WAF challenge encountered", {
      status: response.status,
      body: responseText
    });
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    console.error(`[DeepSeek Auth] Non-JSON response received (HTTP ${response.status}):`, responseText.slice(0, 200));
    throw createSafeUpstreamError("DeepSeek login failed: unable to parse upstream response", {
      status: response.status,
      body: responseText
    });
  }

  console.error(`[DeepSeek Auth] DeepSeek response parsed. biz_code: ${result.data?.biz_code}`);

  if (result.data?.biz_code !== 0) {
    const errorMsg = result.msg || result.data?.biz_msg || "DeepSeek login failed";
    console.error(`[DeepSeek Auth] Login biz_code error (${result.data?.biz_code}): ${errorMsg}`);
    throw new Error(errorMsg);
  }

  console.error(`[DeepSeek Auth] Login successful for user "${maskedUser}"`);
  return result;
}

export async function fetchCurrentDeepseekUser(token, profileSource = {}, proxy) {
  const profile = resolveDeepseekClientProfile(profileSource);
  const requestContext = createProtocolRequestContext(profile, "/users/current", { method: "GET" });
  const targetUrl = `${config.deepseekBaseUrl}${resolveDeepseekApiPath("/users/current")}`;

  const response = await fetch(targetUrl, {
    method: "GET",
    headers: createBaseHeaders(token, {
      ...requestContext.headers
    }, profile),
    dispatcher: resolveProxyDispatcher(proxy)
  });

  let responseText = "";
  try {
    responseText = await response.text();
  } catch (err) {
    throw createSafeUpstreamError("Unable to read upstream response for /users/current", {
      status: response.status,
      body: ""
    });
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw createSafeUpstreamError("Unable to parse upstream response for /users/current", {
      status: response.status,
      body: responseText
    });
  }

  if (result.data?.biz_code !== 0 && result.code !== 0) {
    throw new Error(result.msg || result.data?.biz_msg || "Token không hợp lệ hoặc đã hết hạn");
  }

  return result.data?.biz_data?.user ?? result.data?.user ?? result.data;
}

export async function refreshAccountToken(account) {
  if (!account.loginValue || !account.password || account.credentialMode !== "persistent") {
    throw new Error("Account credentials are not persisted; rebind this account to refresh the session");
  }

  const accountWithProfile = withResolvedDeepseekClientProfile(account);
  const loginResult = await loginToDeepseek({
    loginValue: accountWithProfile.loginValue,
    password: accountWithProfile.password,
    deviceProfile: accountWithProfile.deviceProfile,
    proxy: accountWithProfile.proxy
  });

  const user = loginResult.data.biz_data.user;
  const refreshedAccount = saveAccount({
    ...accountWithProfile,
    token: user.token,
    ssoId: user.id,
    status: "online"
  });

  await reportClientSettingsForAccount(refreshedAccount);
  return refreshedAccount;
}
