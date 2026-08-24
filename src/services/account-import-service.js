import { saveAccount } from "./account-service.js";
import { buildDeepseekAccountForOwner } from "./auth-service.js";
import { loginToDeepseek, fetchCurrentDeepseekUser } from "./deepseek-auth.js";
import { resolveDeepseekClientProfile } from "./deepseek-device.js";
import {
  disableDataOptimizationForAccount,
  reportClientSettingsForAccount
} from "./deepseek-settings.js";
import { maskIdentifier } from "../utils/privacy.js";
import { createId } from "../utils/id.js";

export async function importDeepseekAccountForOwner({
  deviceId,
  deviceProfile,
  loginValue,
  ownerId,
  password,
  proxy
}) {
  const maskedUser = maskIdentifier(loginValue);
  console.error(`[Account Import] Step 1/4: Starting account import for user "${maskedUser}" (owner: ${ownerId})`);

  const resolvedProfile = resolveDeepseekClientProfile(deviceProfile ?? { deviceId });
  console.error(`[Account Import] Step 2/4: Device profile resolved. Logging in to DeepSeek...`);

  const loginResult = await loginToDeepseek({
    loginValue,
    password,
    deviceProfile: resolvedProfile,
    proxy
  });

  console.error(`[Account Import] Step 3/4: DeepSeek login successful. Building account data...`);
  const pendingAccount = await buildDeepseekAccountForOwner({
    ownerId,
    loginValue,
    password,
    proxy,
    deviceProfile: resolvedProfile,
    loginResult
  });

  // Privacy is part of account import success. Do not persist a newly bound
  // account until the upstream setting has been confirmed.
  console.error(`[Account Import] Step 4/4: Disabling upstream data optimization...`);
  const privacyResult = await disableDataOptimizationForAccount(pendingAccount);
  const account = saveAccount({
    ...pendingAccount,
    dataOptimizationDisabled: privacyResult.trainingAllowed === false,
    lastPrivacyUpdate: privacyResult.confirmedAt,
    trainingAllowed: false
  });
  console.error(`[Account Import] Reporting client settings for account ID: ${account.id}...`);
  const reportResult = await reportClientSettingsForAccount(account);
  const finalAccount = reportResult.account ?? account;
  console.error(`[Account Import] Successfully completed import for account ID: ${finalAccount.id}`);
  return finalAccount;
}

export async function importRawDeepseekAccountForOwner({ ownerId, rawInput, proxy }) {
  let parsed;
  const trimmedInput = String(rawInput ?? "").trim();

  if (trimmedInput.startsWith("{") || trimmedInput.startsWith("[")) {
    try {
      parsed = JSON.parse(trimmedInput);
    } catch {
      throw new Error("Chuỗi JSON không hợp lệ. Vui lòng kiểm tra lại cấu trúc JSON.");
    }
  } else if (trimmedInput) {
    // If user passed just a plain token string
    parsed = { token: trimmedInput.replace(/^Bearer\s+/i, "") };
  } else if (rawInput && typeof rawInput === "object") {
    parsed = rawInput;
  } else {
    throw new Error("Không tìm thấy dữ liệu JSON hoặc Token.");
  }

  // Handle if user pasted an array of accounts or a single object wrapper like { accounts: [...] }
  if (Array.isArray(parsed)) {
    parsed = parsed[0];
  } else if (Array.isArray(parsed?.accounts)) {
    parsed = parsed.accounts[0];
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Dữ liệu JSON không đúng định dạng tài khoản.");
  }

  proxy = proxy || parsed.proxy || parsed.proxyUrl || "";
  const token = (parsed.token || parsed.user?.token || parsed.biz_data?.user?.token || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    throw new Error("Không tìm thấy 'token' trong dữ liệu. Vui lòng cung cấp JSON hoặc Token hợp lệ.");
  }

  const loginValue = (parsed.loginValue || parsed.email || parsed.username || parsed.user?.email || "").trim();
  const password = parsed.password || "";
  const resolvedProfile = resolveDeepseekClientProfile(parsed.deviceProfile ?? { deviceId: parsed.deviceId || parsed.loginDeviceId });

  console.error(`[Account Import JSON] Importing account via JSON for owner: ${ownerId}...`);

  let user = null;
  try {
    user = await fetchCurrentDeepseekUser(token, resolvedProfile, proxy);
    console.error(`[Account Import JSON] Verified token with DeepSeek. User ID: ${user.id}`);
  } catch (err) {
    console.error(`[Account Import JSON] Verification via /users/current skipped (${err.message}). Using JSON fields.`);
    user = {
      id: parsed.deepseekUserId || parsed.ssoId || parsed.user?.id || parsed.id || createId(),
      email: loginValue,
      mobile_number: parsed.mobileMasked || "",
      area_code: parsed.areaCode || "+86"
    };
  }

  const loginResult = {
    data: {
      biz_code: 0,
      biz_data: {
        user: {
          id: user.id || parsed.deepseekUserId || parsed.ssoId || createId(),
          token,
          email: user.email || loginValue,
          mobile_number: user.mobile_number || "",
          area_code: user.area_code || "+86"
        }
      }
    }
  };

  const pendingAccount = await buildDeepseekAccountForOwner({
    ownerId,
    loginValue: loginValue || user.email || "JSON_User",
    password,
    proxy,
    deviceProfile: resolvedProfile,
    loginResult
  });

  if (parsed.deviceProfile) {
    pendingAccount.deviceProfile = parsed.deviceProfile;
  }

  console.error(`[Account Import JSON] Disabling upstream data optimization...`);
  let privacyResult = { trainingAllowed: false, confirmedAt: new Date().toISOString() };
  try {
    privacyResult = await disableDataOptimizationForAccount(pendingAccount);
  } catch (err) {
    console.error(`[Account Import JSON] Privacy update warning: ${err.message}`);
  }

  const account = saveAccount({
    ...pendingAccount,
    dataOptimizationDisabled: privacyResult.trainingAllowed === false,
    lastPrivacyUpdate: privacyResult.confirmedAt,
    trainingAllowed: false
  });

  try {
    await reportClientSettingsForAccount(account);
  } catch {}

  console.error(`[Account Import JSON] Successfully imported account ID: ${account.id}`);
  return account;
}
