import { config, resolveDeepseekApiPath } from "../config.js";
import { createSafeUpstreamError, redactSensitiveText } from "../utils/privacy.js";
import { saveAccount } from "./account-service.js";
import { createDeepseekClientHeaders, resolveDeepseekClientProfile } from "./deepseek-device.js";
import { createProtocolRequestContext } from "./deepseek-protocol.js";

const SETTINGS_SCOPES = Object.freeze(["main", "model", "web_upgrade", "banner"]);

function createSettingsHeaders(account, extraHeaders = {}) {
  return createDeepseekClientHeaders(account, {
    authorization: `Bearer ${account.token}`,
    ...extraHeaders
  });
}

function collectSettingIds(value, ids = new Set()) {
  if (!value || typeof value !== "object") return ids;
  if (Number.isInteger(value.id)) ids.add(value.id);

  const children = Array.isArray(value) ? value : Object.values(value);
  children.forEach((entry) => collectSettingIds(entry, ids));
  return ids;
}

function createReportDid(account) {
  return resolveDeepseekClientProfile(account).clientDid;
}

async function fetchScopeSettings(account, scope) {
  const profile = resolveDeepseekClientProfile(account);
  const requestContext = createProtocolRequestContext(profile, "/client/settings");
  const url = new URL(resolveDeepseekApiPath("/client/settings"), config.deepseekBaseUrl);
  url.searchParams.set("did", profile.clientDid);
  url.searchParams.set("scope", scope);

  const response = await fetch(url, {
    method: "GET",
    headers: createSettingsHeaders(account, {
      ...requestContext.headers,
      accept: "application/json"
    })
  });

  let payload;
  let responseText = "";
  try {
    responseText = await response.text();
    payload = JSON.parse(responseText);
  } catch {
    throw createSafeUpstreamError(`Settings ${scope} request failed: unable to parse upstream response`, {
      status: response.status,
      body: responseText
    });
  }

  if (!response.ok || payload?.data?.biz_code !== 0) {
    throw new Error(payload?.data?.biz_msg || payload?.msg || `Settings ${scope} failed`);
  }

  return payload;
}

async function reportSettings(account, settingsIds) {
  const requestContext = createProtocolRequestContext(account, "/client/settings/report");
  const response = await fetch(`${config.deepseekBaseUrl}${resolveDeepseekApiPath("/client/settings/report")}`, {
    method: "POST",
    headers: createSettingsHeaders(account, {
      ...requestContext.headers,
      "content-type": "application/json"
    }),
    body: JSON.stringify({
      settings_ids: [...settingsIds],
      did: createReportDid(account),
      sso_id: account.ssoId || account.deepseekUserId || ""
    })
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || (typeof payload?.data?.biz_code === "number" && payload.data.biz_code !== 0)) {
    throw new Error(payload?.data?.biz_msg || payload?.msg || "Settings report failed");
  }

  return payload;
}

export async function reportClientSettingsForAccount(account) {
  const profile = resolveDeepseekClientProfile(account);
  if (!account?.token || !profile.clientDid) {
    return { ok: false, settingsIds: [], error: "Missing token or client_did" };
  }

  try {
    const settingsIds = new Set();
    for (const scope of SETTINGS_SCOPES) {
      const payload = await fetchScopeSettings(account, scope);
      collectSettingIds(payload?.data?.biz_data ?? payload?.data ?? payload, settingsIds);
    }

    await reportSettings(account, settingsIds);
    const updatedAccount = saveAccount({
      ...account,
      deviceId: profile.loginDeviceId,
      loginDeviceId: profile.loginDeviceId,
      clientDid: profile.clientDid,
      deviceProfile: profile,
      settingsIds: [...settingsIds],
      settingsReported: true,
      lastSettingsReport: new Date().toISOString(),
      lastSettingsError: ""
    });

    return { ok: true, settingsIds: [...settingsIds], account: updatedAccount };
  } catch (error) {
    saveAccount({
      ...account,
      settingsReported: false,
      lastSettingsError: redactSensitiveText(error.message),
      lastSettingsReport: new Date().toISOString()
    });
    return { ok: false, settingsIds: [], error: redactSensitiveText(error.message) };
  }
}
