import { config, resolveDeepseekApiPath } from "../config.js";
import { createSafeUpstreamError } from "../utils/privacy.js";
import { saveAccount } from "./account-service.js";
import {
  createDeepseekClientHeaders,
  resolveDeepseekClientProfile,
  withResolvedDeepseekClientProfile
} from "./deepseek-device.js";
import { createProtocolRequestContext } from "./deepseek-protocol.js";
import { reportClientSettingsForAccount } from "./deepseek-settings.js";

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

export async function loginToDeepseek({ loginValue, password, deviceId, deviceProfile }) {
  const profile = resolveDeepseekClientProfile(deviceProfile ?? { deviceId });
  const requestContext = createProtocolRequestContext(profile, "/users/login");
  const response = await fetch(`${config.deepseekBaseUrl}${resolveDeepseekApiPath("/users/login")}`, {
    method: "POST",
    headers: createBaseHeaders("", {
      ...requestContext.headers,
      "content-type": "application/json"
    }, profile),
    body: JSON.stringify(buildLoginPayload(loginValue, password, profile))
  });

  let result;
  let responseText = "";
  try {
    responseText = await response.text();
    result = JSON.parse(responseText);
  } catch {
    throw createSafeUpstreamError("DeepSeek login failed: unable to parse upstream response", {
      status: response.status,
      body: responseText
    });
  }

  if (result.data?.biz_code !== 0) {
    throw new Error(result.msg || result.data?.biz_msg || "DeepSeek login failed");
  }

  return result;
}

export async function refreshAccountToken(account) {
  if (!account.loginValue || !account.password || account.credentialMode !== "persistent") {
    throw new Error("Account credentials are not persisted; rebind this account to refresh the session");
  }

  const accountWithProfile = withResolvedDeepseekClientProfile(account);
  const loginResult = await loginToDeepseek({
    loginValue: accountWithProfile.loginValue,
    password: accountWithProfile.password,
    deviceProfile: accountWithProfile.deviceProfile
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
