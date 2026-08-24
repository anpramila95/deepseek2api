import bcrypt from "bcrypt";
import { config } from "../config.js";
import { listAccounts, listAccountsForOwner, resolveAccountLabel, saveAccount } from "./account-service.js";
import { getIncognitoStateForOwner } from "./incognito-service.js";
import { isLocalOwnerId, createLocalOwnerId } from "./owner-service.js";
import { createSession, deleteSession, getSession } from "./session-service.js";
import { authenticateLocalUser, getLocalUserFromSession, registerLocalUser } from "./user-service.js";
import { maskIdentifier } from "../utils/privacy.js";
import { resolveDeepseekClientProfile, withResolvedDeepseekClientProfile } from "./deepseek-device.js";
import { fetchCurrentDeepseekUser, refreshAccountToken } from "./deepseek-auth.js";

const BCRYPT_SALT_ROUNDS = 10;

export function resolveSession(request) {
  const cookie = request.cookies?.[config.sessionCookieName];
  const session = cookie ? getSession(cookie) : null;
  if (!session) {
    return null;
  }

  if (session.role !== "user" || (!session.userId && !isLocalOwnerId(session.ownerId))) {
    return session;
  }

  const user = getLocalUserFromSession(session);
  if (!user || user.disabled) {
    deleteSession(session.id);
    return null;
  }

  return {
    ...session,
    ownerId: createLocalOwnerId(user.id),
    userId: user.id,
    username: user.username
  };
}

export function getVisibleAccounts(session) {
  if (!session) {
    return [];
  }

  return session.role === "admin"
    ? listAccounts()
    : listAccountsForOwner(session.ownerId);
}

export function resolveScopedAccount(session, requestedAccountId) {
  const visibleAccounts = getVisibleAccounts(session);
  const resolvedAccountId = requestedAccountId ?? visibleAccounts[0]?.id;
  return visibleAccounts.find((account) => account.id === resolvedAccountId) ?? null;
}

export async function checkAndRefreshAccount(account) {
  const accountWithProfile = withResolvedDeepseekClientProfile(account);
  try {
    await fetchCurrentDeepseekUser(accountWithProfile.token, accountWithProfile.deviceProfile);
    return saveAccount({
      ...accountWithProfile,
      status: "online",
      updatedAt: new Date().toISOString()
    });
  } catch {
    if (accountWithProfile.credentialMode === "persistent" && accountWithProfile.loginValue && accountWithProfile.password) {
      try {
        return await refreshAccountToken(accountWithProfile);
      } catch {
        // failed to refresh
      }
    }
    return saveAccount({
      ...accountWithProfile,
      status: "offline",
      updatedAt: new Date().toISOString()
    });
  }
}

export async function checkAccountsForSession(session, accountId = null) {
  const visibleAccounts = getVisibleAccounts(session);
  if (accountId) {
    const target = visibleAccounts.find((acc) => acc.id === accountId);
    if (!target) {
      throw new Error("Account not found");
    }
    const updated = await checkAndRefreshAccount(target);
    return [updated];
  }

  const updatedAccounts = [];
  for (const account of visibleAccounts) {
    try {
      const updated = await checkAndRefreshAccount(account);
      updatedAccounts.push(updated);
    } catch {
      updatedAccounts.push(account);
    }
  }
  return updatedAccounts;
}

export async function loginAsAdmin(username, password) {
  if (!config.admin.enabled) {
    return null;
  }

  if (username !== config.admin.username) {
    return null;
  }

  // Admin password can be either a plaintext (fallback) or bcrypt hash
  const storedPassword = config.admin.password;
  const isHash = storedPassword.startsWith("$2b$") || storedPassword.startsWith("$2a$") || storedPassword.startsWith("$2y$");

  let isValid = false;
  if (isHash) {
    isValid = await bcrypt.compare(password, storedPassword);
  } else {
    // Plaintext fallback (deprecated, remove in future)
    isValid = password === storedPassword;
  }

  if (!isValid) {
    return null;
  }

  return createSession({
    ownerId: "admin",
    role: "admin",
    username: config.admin.username
  });
}

function createLocalUserSession(user) {
  return createSession({
    ownerId: createLocalOwnerId(user.id),
    role: "user",
    userId: user.id,
    username: user.username
  });
}

export async function buildDeepseekAccountForOwner({
  deviceId,
  deviceProfile,
  loginResult,
  loginValue,
  ownerId,
  password
}) {
  const user = loginResult.data.biz_data.user;
  const emailMasked = maskIdentifier(user.email ?? loginValue);
  const mobileMasked = maskIdentifier(user.mobile_number ?? "");
  const loginValueMasked = maskIdentifier(loginValue);
  const resolvedProfile = resolveDeepseekClientProfile(deviceProfile ?? { deviceId });

  let credentialPatch;
  if (config.security.persistAccountCredentials) {
    // Hash password before storing
    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    credentialPatch = { credentialMode: "persistent", loginValue, password: hashedPassword };
  } else {
    credentialPatch = { credentialMode: "ephemeral", loginValue: loginValueMasked, password: "" };
  }

  return {
    ownerId,
    deepseekUserId: user.id,
    ...credentialPatch,
    loginValueMasked,
    deviceId: resolvedProfile.loginDeviceId,
    loginDeviceId: resolvedProfile.loginDeviceId,
    clientDid: resolvedProfile.clientDid,
    deviceProfile: resolvedProfile,
    token: user.token,
    displayName: resolveAccountLabel({ emailMasked, loginValue: loginValueMasked, mobileMasked }),
    emailMasked,
    mobileMasked,
    areaCode: user.area_code ?? "+86",
    ssoId: user.id,
    status: "online",
    captchaState: {
      triggered: false,
      triggerTime: null,
      imageUrl: null,
      instruction: null,
      rid: null
    },
    dataOptimizationDisabled: false,
    lastPrivacyUpdate: null,
    settingsReported: false,
    lastSettingsReport: null
  };
}

export async function saveDeepseekAccountForOwner(options) {
  const account = await buildDeepseekAccountForOwner(options);
  return saveAccount(account);
}

export async function loginAsLocalUser(username, password) {
  const user = await authenticateLocalUser({ username, password });
  return user ? createLocalUserSession(user) : null;
}

export async function registerLocalUserSession(options) {
  const user = await registerLocalUser(options);
  return createLocalUserSession(user);
}

export function getSessionIncognitoState(session) {
  if (!session) {
    return {
      effectiveEnabled: false,
      globalEnabled: false,
      ownerEnabled: false
    };
  }

  return getIncognitoStateForOwner(session.ownerId);
}
