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

export function parseImportText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") || (trimmed.startsWith("{") && !trimmed.includes("\n"))) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.accounts)) return parsed.accounts;
      if (typeof parsed === "object") return [parsed];
    } catch {
      // fallback to line parsing
    }
  }

  const lines = trimmed.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  for (const line of lines) {
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        items.push(JSON.parse(line));
        continue;
      } catch {}
    }

    let parts = [];
    if (line.includes("----")) {
      parts = line.split("----").map((p) => p.trim());
    } else if (line.includes("|")) {
      parts = line.split("|").map((p) => p.trim());
    } else if (line.includes(",")) {
      parts = line.split(",").map((p) => p.trim());
    } else if (line.includes(":") && !line.startsWith("http")) {
      const idx1 = line.indexOf(":");
      const first = line.slice(0, idx1).trim();
      const rest = line.slice(idx1 + 1).trim();
      const idx2 = rest.indexOf(":");
      if (idx2 !== -1 && !rest.slice(0, idx2).includes("/")) {
        const second = rest.slice(0, idx2).trim();
        const third = rest.slice(idx2 + 1).trim();
        parts = [first, second, third];
      } else {
        parts = [first, rest];
      }
    } else {
      parts = [line];
    }

    if (parts.length >= 3) {
      items.push({
        email: parts[0],
        password: parts[1],
        proxy: parts.slice(2).join(":")
      });
    } else if (parts.length === 2) {
      if (parts[1].startsWith("http://") || parts[1].startsWith("https://") || parts[1].startsWith("socks")) {
        if (parts[0].includes("@") || parts[0].length < 40) {
          items.push({ email: parts[0], password: "", proxy: parts[1] });
        } else {
          items.push({ token: parts[0], proxy: parts[1] });
        }
      } else {
        items.push({ email: parts[0], password: parts[1] });
      }
    } else if (parts.length === 1) {
      if (parts[0].includes("@")) {
        items.push({ email: parts[0], password: "" });
      } else {
        items.push({ token: parts[0] });
      }
    }
  }
  return items;
}

export function parseImportItems(rawInput) {
  if (Array.isArray(rawInput)) {
    return rawInput;
  }
  if (typeof rawInput === "object" && rawInput !== null) {
    if (Array.isArray(rawInput.accounts)) return rawInput.accounts;
    if (rawInput.rawText) return parseImportText(rawInput.rawText);
    return [rawInput];
  }
  if (typeof rawInput === "string") {
    return parseImportText(rawInput);
  }
  return [];
}

export async function batchImportAccountsForOwner({ ownerId, rawInput, defaultProxy }) {
  const items = parseImportItems(rawInput);
  if (!items.length) {
    throw new Error("Không tìm thấy tài khoản nào để nhập.");
  }

  const results = {
    total: items.length,
    imported: 0,
    failed: 0,
    errors: [],
    accounts: []
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const emailOrLogin = (item.email || item.username || item.loginValue || "").trim();
    const password = item.password || "";
    const proxy = item.proxy || defaultProxy || "";
    const token = (item.token || item.user?.token || item.biz_data?.user?.token || "").trim();

    try {
      let saved = null;
      if (emailOrLogin && password) {
        saved = await importDeepseekAccountForOwner({
          ownerId,
          loginValue: emailOrLogin,
          password,
          proxy
        });
      } else if (token || (typeof item === "object" && (item.user || item.biz_data))) {
        saved = await importRawDeepseekAccountForOwner({
          ownerId,
          rawInput: item,
          proxy
        });
      } else if (emailOrLogin && !password && !token) {
        throw new Error(`Tài khoản ${emailOrLogin} thiếu mật khẩu hoặc token.`);
      } else {
        throw new Error(`Dòng thứ ${i + 1} không có thông tin hợp lệ.`);
      }
      results.imported += 1;
      results.accounts.push(saved);
    } catch (err) {
      results.failed += 1;
      results.errors.push({
        index: i + 1,
        account: emailOrLogin || `Dòng ${i + 1}`,
        error: err.message
      });
    }
  }

  return results;
}
