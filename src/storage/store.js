import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { config } from "../config.js";
import { maskIdentifier } from "../utils/privacy.js";
import { withResolvedDeepseekClientProfile } from "../services/deepseek-device.js";

function defaultState() {
  return {
    accounts: [],
    apiKeys: [],
    chainOfThoughtOverride: {
      owners: {}
    },
    toolParsingMode: {
      owners: {}
    },
    incognito: {
      globalEnabled: false,
      owners: {}
    },
    invites: [],
    registration: {
      inviteRequired: false
    },
    sessions: [],
    sharedAccountMode: {
      enabled: false
    },
    systemSettings: {
      captcha: {},
      inputContentLimit: config.deepseekCompletion.inputContentLimit
    },
    users: [],
    usageStats: {
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      requests: 0,
      byPath: {}
    }
  };
}

function normalizeChainOfThoughtOverride(value) {
  const owners = value?.owners;

  return {
    owners: owners && typeof owners === "object"
      ? Object.fromEntries(
          Object.entries(owners).map(([ownerId, enabled]) => [ownerId, normalizeBoolean(enabled)])
        )
      : {}
  };
}

function normalizeToolParsingMode(value) {
  const owners = value?.owners;

  return {
    owners: owners && typeof owners === "object"
      ? Object.fromEntries(
          Object.entries(owners).map(([ownerId, enabled]) => [ownerId, normalizeBoolean(enabled)])
        )
      : {}
  };
}

function normalizeIncognito(value) {
  const owners = value?.owners;

  return {
    globalEnabled: Boolean(value?.globalEnabled),
    owners: owners && typeof owners === "object" ? owners : {}
  };
}

function normalizeInvites(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRegistration(value) {
  return {
    inviteRequired: Boolean(value?.inviteRequired)
  };
}

function normalizeSharedAccountMode(value, incognito, accounts) {
  const hasUsableAccount = accounts.some((account) => account?.id && account?.token);

  return {
    enabled: Boolean(value?.enabled && incognito.globalEnabled && hasUsableAccount)
  };
}

function normalizeNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "off", "no"].includes(normalized)) {
      return false;
    }
    if (["true", "1", "on", "yes"].includes(normalized)) {
      return true;
    }
  }

  return Boolean(value);
}

function normalizeSystemSettings(value) {
  const captcha = value?.captcha && typeof value.captcha === "object" ? value.captcha : {};
  const chainOfThoughtOverrideEnabled = value?.chainOfThoughtOverrideEnabled
    ?? value?.expertPromptSuffixEnabled
    ?? value?.expertModePromptSuffixEnabled
    ?? value?.prompt?.chainOfThoughtOverrideEnabled
    ?? value?.prompt?.expertPromptSuffixEnabled
    ?? value?.prompt?.expertModePromptSuffixEnabled;
  const toolParsingModeEnabled = value?.toolParsingModeEnabled
    ?? value?.toolParserEnabled
    ?? value?.prompt?.toolParsingModeEnabled
    ?? value?.prompt?.toolParserEnabled;
  const inputContentLimit = value?.inputContentLimit
    ?? value?.promptChunkLimit
    ?? value?.prompt?.inputContentLimit
    ?? value?.prompt?.chunkLimit;
  const globalProxies = Array.isArray(value?.globalProxies)
    ? value.globalProxies.map((item) => String(item || "").trim()).filter(Boolean)
    : typeof value?.globalProxies === "string"
      ? value.globalProxies.split(/[\r\n]+/).map((item) => item.trim()).filter(Boolean)
      : [];

  return {
    captcha: {
      yescaptchaEndpoint: typeof captcha.yescaptchaEndpoint === "string" ? captcha.yescaptchaEndpoint : "",
      yescaptchaKey: typeof captcha.yescaptchaKey === "string" ? captcha.yescaptchaKey : "",
      autoSolveEnabled: captcha.autoSolveEnabled === undefined ? undefined : Boolean(captcha.autoSolveEnabled),
      visionFallbackEnabled: captcha.visionFallbackEnabled === undefined
        ? undefined
        : Boolean(captcha.visionFallbackEnabled),
      visionFallbackAccountId: typeof captcha.visionFallbackAccountId === "string"
        ? captcha.visionFallbackAccountId
        : null,
      maxRetries: captcha.maxRetries === undefined
        ? undefined
        : normalizeNumber(captcha.maxRetries, undefined, { min: 1, max: 20 }),
      cooldownMs: captcha.cooldownMs === undefined
        ? undefined
        : normalizeNumber(captcha.cooldownMs, undefined, { min: 0, max: 3_600_000 })
    },
    inputContentLimit: normalizeNumber(
      inputContentLimit,
      config.deepseekCompletion.inputContentLimit,
      { min: 1, max: 10_000_000 }
    ),
    globalProxies,
    ...(chainOfThoughtOverrideEnabled === undefined
      ? {}
      : { chainOfThoughtOverrideEnabled: normalizeBoolean(chainOfThoughtOverrideEnabled) }),
    ...(toolParsingModeEnabled === undefined
      ? {}
      : { toolParsingModeEnabled: normalizeBoolean(toolParsingModeEnabled) })
  };
}

function normalizeUsers(value) {
  const normalizeLimit = (limit) => {
    const parsed = Number(limit);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  };

  return Array.isArray(value) ? value.map((user) => ({
    ...user,
    disabled: Boolean(user?.disabled),
    requestLimits: {
      maxConcurrency: normalizeLimit(user?.requestLimits?.maxConcurrency),
      maxRequestsPerMinute: normalizeLimit(user?.requestLimits?.maxRequestsPerMinute)
    }
  })) : [];
}

function normalizeApiKeys(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((record) => {
    const { key: _legacyPlainKey, ...safeRecord } = record;
    return {
      ...safeRecord,
      toolCallsEnabled: Boolean(record?.toolCallsEnabled)
    };
  });
}

function normalizeAccounts(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((account) => {
    const loginValueMasked = account?.loginValueMasked || maskIdentifier(account?.loginValue);
    const nextAccount = {
      ...account,
      credentialMode: account?.credentialMode ?? (
        account?.password && config.security.persistAccountCredentials ? "persistent" : "ephemeral"
      ),
      loginValueMasked,
      displayName: account?.displayName ? maskIdentifier(account.displayName) : loginValueMasked,
      emailMasked: maskIdentifier(account?.emailMasked),
      mobileMasked: maskIdentifier(account?.mobileMasked)
    };

    if (!config.security.persistAccountCredentials) {
      nextAccount.loginValue = loginValueMasked;
      nextAccount.password = "";
      nextAccount.credentialMode = "ephemeral";
    }

    return withResolvedDeepseekClientProfile(nextAccount);
  });
}

function normalizeState(value) {
  const incognito = normalizeIncognito(value?.incognito);
  const accounts = normalizeAccounts(value?.accounts);

  return {
    accounts,
    apiKeys: normalizeApiKeys(value?.apiKeys),
    chainOfThoughtOverride: normalizeChainOfThoughtOverride(value?.chainOfThoughtOverride),
    toolParsingMode: normalizeToolParsingMode(value?.toolParsingMode),
    incognito,
    invites: normalizeInvites(value?.invites),
    registration: normalizeRegistration(value?.registration),
    sessions: Array.isArray(value?.sessions) ? value.sessions : [],
    sharedAccountMode: normalizeSharedAccountMode(value?.sharedAccountMode, incognito, accounts),
    systemSettings: normalizeSystemSettings(value?.systemSettings),
    users: normalizeUsers(value?.users),
    usageStats: {
      totalTokens: normalizeNumber(value?.usageStats?.totalTokens, 0),
      promptTokens: normalizeNumber(value?.usageStats?.promptTokens, 0),
      completionTokens: normalizeNumber(value?.usageStats?.completionTokens, 0),
      requests: normalizeNumber(value?.usageStats?.requests, 0),
      byPath: value?.usageStats?.byPath && typeof value.usageStats.byPath === "object"
        ? value.usageStats.byPath
        : {}
    }
  };
}

export function readStore() {
  if (!existsSync(config.dataFile)) {
    const state = defaultState();
    writeStore(state);
    return state;
  }

  const raw = readFileSync(config.dataFile, "utf8");
  const normalized = normalizeState(JSON.parse(raw));
  const serialized = JSON.stringify(normalized, null, 2);

  if (serialized !== raw) {
    writeFileSync(config.dataFile, serialized);
  }

  return normalized;
}

export function writeStore(state) {
  writeFileSync(config.dataFile, JSON.stringify(normalizeState(state), null, 2));
}

export function updateStore(updater) {
  const current = readStore();
  const next = updater(current);
  writeStore(next);
  return next;
}
