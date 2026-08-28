import { config } from "../config.js";
import { listApiKeysForOwner } from "./api-key-service.js";
import { getChainOfThoughtOverrideState } from "./chain-of-thought-override-service.js";
import { getSessionIncognitoState, getVisibleAccounts } from "./auth-service.js";
import { listPublicInvites } from "./invite-service.js";
import { getRegistrationSettings } from "./registration-service.js";
import { buildSharedAccountModePayload } from "./shared-account-mode-service.js";
import { getPublicSystemSettings } from "./system-settings-service.js";
import { getToolParsingModeState } from "./tool-parsing-mode-service.js";
import { listPublicUsers } from "./user-service.js";
import { maskIdentifier } from "../utils/privacy.js";

export function toPublicAccount(account) {
  const loginValue = account.loginValue || account.loginValueMasked || maskIdentifier(account.loginValue);

  return {
    id: account.id,
    ownerId: account.ownerId,
    loginValue,
    displayName: account.displayName || loginValue,
    emailMasked: maskIdentifier(account.emailMasked),
    mobileMasked: maskIdentifier(account.mobileMasked),
    credentialMode: account.credentialMode ?? "legacy",
    status: account.status ?? (account.token ? "online" : "offline"),
    dataOptimizationDisabled: account.dataOptimizationDisabled === true,
    lastPrivacyUpdate: account.lastPrivacyUpdate ?? null,
    settingsReported: Boolean(account.settingsReported),
    lastSettingsReport: account.lastSettingsReport ?? null,
    captchaState: account.captchaState ?? null,
    proxyConfigured: Boolean(account.proxy),
    updatedAt: account.updatedAt
  };
}

function toIncognitoPayload(session) {
  const state = getSessionIncognitoState(session);
  const scope = session.role === "admin" ? "global" : "self";

  return {
    effectiveEnabled: state.effectiveEnabled,
    globalEnabled: state.globalEnabled,
    ownerEnabled: state.ownerEnabled,
    scope,
    scopeEnabled: scope === "global" ? state.globalEnabled : state.ownerEnabled
  };
}

function toChainOfThoughtOverridePayload(session) {
  const state = getChainOfThoughtOverrideState(session.ownerId);

  return {
    ...state,
    scope: "self",
    scopeEnabled: state.ownerEnabled
  };
}

function toToolParsingModePayload(session) {
  const state = getToolParsingModeState(session.ownerId);

  return {
    ...state,
    scope: "self",
    scopeEnabled: state.ownerEnabled
  };
}

export function buildAdminData() {
  return {
    invites: listPublicInvites(),
    registration: getRegistrationSettings(),
    systemSettings: getPublicSystemSettings(),
    users: listPublicUsers()
  };
}

export function buildSessionPayload(session) {
  const payload = {
    authenticated: true,
    role: session.role,
    ownerId: session.ownerId,
    username: session.username ?? "",
    accounts: getVisibleAccounts(session).map(toPublicAccount),
    apiKeys: listApiKeysForOwner(session.ownerId),
    adminEnabled: config.admin.enabled,
    registration: getRegistrationSettings(),
    systemSettings: getPublicSystemSettings(),
    chainOfThoughtOverride: toChainOfThoughtOverridePayload(session),
    toolParsingMode: toToolParsingModePayload(session),
    incognito: toIncognitoPayload(session),
    sharedAccountMode: buildSharedAccountModePayload(session)
  };

  if (session.role === "admin") {
    return {
      ...payload,
      adminData: buildAdminData()
    };
  }

  return payload;
}

export function buildAnonymousPayload() {
  return {
    authenticated: false,
    adminEnabled: config.admin.enabled,
    registration: getRegistrationSettings(),
    systemSettings: getPublicSystemSettings()
  };
}
