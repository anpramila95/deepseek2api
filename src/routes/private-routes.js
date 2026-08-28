import {
  createApiKeyRecord,
  deleteApiKeyRecord,
  listApiKeysForOwner,
  updateApiKeyRecord
} from "../services/api-key-service.js";
import {
  checkAccountsForSession,
  getSessionIncognitoState,
  getVisibleAccounts,
  resolveScopedAccount
} from "../services/auth-service.js";
import {
  deleteAccountById,
  isUsableAccount,
  listUsableAccountsForOwner,
  resolveAccountLabel
} from "../services/account-service.js";
import {
  batchImportAccountsForOwner,
  importDeepseekAccountForOwner,
  importRawDeepseekAccountForOwner
} from "../services/account-import-service.js";
import { maskIdentifier } from "../utils/privacy.js";
import { readStore } from "../storage/store.js";
import { createGuestPowHeader } from "../services/deepseek-proxy.js";
import {
  attemptCaptchaAutoSolveForAccount,
  clearCaptchaState,
  resolveCaptchaManually
} from "../services/captcha-service.js";
import {
  getChainOfThoughtOverrideState,
  setOwnerChainOfThoughtOverrideEnabled
} from "../services/chain-of-thought-override-service.js";
import { setGlobalIncognitoEnabled, setOwnerIncognitoEnabled } from "../services/incognito-service.js";
import { listRequestLogs } from "../services/request-log-service.js";
import {
  assertOwnerHasUsableAccount,
  isSharedAccountModeEnabled
} from "../services/shared-account-mode-service.js";
import { toPublicAccount } from "../services/app-payload-service.js";
import {
  getToolParsingModeState,
  setOwnerToolParsingModeEnabled
} from "../services/tool-parsing-mode-service.js";
import { parseJsonBody, readRequestBody, sendError, sendJson } from "../utils/http.js";

async function readJsonRequest(request) {
  return parseJsonBody(await readRequestBody(request)) ?? {};
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

async function handleAccountCreation(request, response, session) {
  const body = await readJsonRequest(request);
  const rawInput = body.rawJson || body.token || (typeof body.username === "string" && body.username.trim().startsWith("{") ? body.username : "");

  if (rawInput) {
    console.error(`[API /api/accounts] POST request received to import account via JSON/Token (owner: ${session.ownerId})`);

    try {
      const account = await importRawDeepseekAccountForOwner({
        ownerId: session.ownerId,
        rawInput,
        proxy: body.proxy
      });
      console.error(`[API /api/accounts] Account creation via JSON succeeded (account ID: ${account.id})`);
      sendJson(response, 200, { account: toPublicAccount(account) });
    } catch (error) {
      console.error(`[API /api/accounts] Account creation via JSON failed:`, error.message);
      sendError(response, error.statusCode ?? 400, error.message);
    }
    return true;
  }

  const maskedUser = maskIdentifier(body.username);
  console.error(`[API /api/accounts] POST request received to bind account "${maskedUser}" (owner: ${session.ownerId})`);

  try {
    const account = await importDeepseekAccountForOwner({
      ownerId: session.ownerId,
      loginValue: body.username,
      password: body.password,
      proxy: body.proxy
    });
    console.error(`[API /api/accounts] Account creation succeeded for "${maskedUser}" (account ID: ${account.id})`);
    sendJson(response, 200, { account: toPublicAccount(account) });
  } catch (error) {
    console.error(`[API /api/accounts] Account creation failed for "${maskedUser}":`, error.message);
    sendError(response, error.statusCode ?? 401, error.message);
  }

  return true;
}

async function handleIncognitoUpdate(request, response, session) {
  const body = await readJsonRequest(request);

  if (session.role === "admin") {
    setGlobalIncognitoEnabled(body.enabled);
  } else {
    setOwnerIncognitoEnabled(session.ownerId, body.enabled);
  }

  sendJson(response, 200, {
    incognito: toIncognitoPayload(session)
  });
  return true;
}

async function handleChainOfThoughtOverrideUpdate(request, response, session) {
  const body = await readJsonRequest(request);
  setOwnerChainOfThoughtOverrideEnabled(session.ownerId, body.enabled);

  sendJson(response, 200, {
    chainOfThoughtOverride: getChainOfThoughtOverrideState(session.ownerId)
  });
  return true;
}

async function handleToolParsingModeUpdate(request, response, session) {
  const body = await readJsonRequest(request);
  setOwnerToolParsingModeEnabled(session.ownerId, body.enabled);

  sendJson(response, 200, {
    toolParsingMode: getToolParsingModeState(session.ownerId)
  });
  return true;
}

function handleAccountDeletion(response, session, url) {
  const accountId = url.pathname.split("/").pop();
  const account = resolveScopedAccount(session, accountId);

  if (!account) {
    sendError(response, 404, "Account not found");
    return true;
  }

  deleteAccountById(account.id);
  sendJson(response, 200, { accountId: account.id, ok: true });
  return true;
}

async function handleCaptchaAction(request, response, session, url) {
  const match = /^\/api\/accounts\/([^/]+)\/captcha\/(resolve|retry|clear)$/.exec(url.pathname);
  if (!match || request.method !== "POST") {
    return false;
  }

  const [, accountId, action] = match;
  const account = resolveScopedAccount(session, accountId);
  if (!account) {
    sendError(response, 404, "Account not found");
    return true;
  }

  try {
    if (action === "resolve") {
      const body = await readJsonRequest(request);
      sendJson(response, 200, { account: toPublicAccount(await resolveCaptchaManually(account, body)) });
      return true;
    }

    if (action === "retry") {
      const result = await attemptCaptchaAutoSolveForAccount(account, { force: true });
      sendJson(response, 200, { account: toPublicAccount(result.account), source: result.source });
      return true;
    }

    sendJson(response, 200, { account: toPublicAccount(clearCaptchaState(account)) });
  } catch (error) {
    sendError(response, 400, error.message);
  }

  return true;
}

function resolveApiKeyAccount(session, requestedAccountId) {
  if (!isSharedAccountModeEnabled()) {
    const account = resolveScopedAccount(session, requestedAccountId);
    return isUsableAccount(account) ? account : null;
  }

  assertOwnerHasUsableAccount(session.ownerId);

  const accounts = listUsableAccountsForOwner(session.ownerId);
  const resolvedAccountId = requestedAccountId ?? accounts[0]?.id;
  return accounts.find((account) => account.id === resolvedAccountId) ?? null;
}

export async function handlePrivateApiRequest({ request, response, session, url }) {
  if (request.method === "GET" && url.pathname === "/api/token_pow_guest") {
    const targetPath = url.searchParams.get("target_path") || "/v0/users/create_email_verification_code";
    const powResponse = await createGuestPowHeader(targetPath);
    sendJson(response, 200, {
      "x-ds-pow-response": powResponse,
      target_path: targetPath
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/usage-stats") {
    sendJson(response, 200, { usage: readStore().usageStats });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/request-logs") {
    sendJson(response, 200, {
      logs: listRequestLogs({
        includeAll: session.role === "admin",
        limit: url.searchParams.get("limit") ?? 100,
        ownerId: session.ownerId
      })
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/accounts/export") {
    const visible = getVisibleAccounts(session);
    sendJson(response, 200, {
      accounts: visible.map((acc) => ({
        email: acc.loginValue || acc.displayName || "",
        password: acc.password || "",
        proxy: acc.proxy || "",
        token: acc.token || "",
        status: acc.status || "online",
        updatedAt: acc.updatedAt
      }))
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/accounts/batch-import") {
    const body = await readJsonRequest(request);
    try {
      const result = await batchImportAccountsForOwner({
        ownerId: session.ownerId,
        rawInput: body.accounts || body.rawText,
        defaultProxy: body.proxy
      });
      sendJson(response, 200, {
        ...result,
        accounts: getVisibleAccounts(session).map(toPublicAccount)
      });
    } catch (err) {
      sendError(response, 400, err.message);
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/accounts") {
    sendJson(response, 200, {
      accounts: getVisibleAccounts(session).map(toPublicAccount)
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/accounts") {
    return handleAccountCreation(request, response, session);
  }

  if (request.method === "POST" && (url.pathname === "/api/accounts/check" || /^\/api\/accounts\/([^/]+)\/check$/.test(url.pathname))) {
    const match = /^\/api\/accounts\/([^/]+)\/check$/.exec(url.pathname);
    const accountId = match ? match[1] : null;
    try {
      const updatedAccounts = await checkAccountsForSession(session, accountId);
      sendJson(response, 200, {
        accounts: getVisibleAccounts(session).map(toPublicAccount)
      });
    } catch (err) {
      sendError(response, 400, err.message);
    }
    return true;
  }

  if (await handleCaptchaAction(request, response, session, url)) {
    return true;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/accounts/")) {
    return handleAccountDeletion(response, session, url);
  }

  if (request.method === "POST" && url.pathname === "/api/incognito") {
    return handleIncognitoUpdate(request, response, session);
  }

  if (request.method === "POST" && url.pathname === "/api/chain-of-thought-override") {
    return handleChainOfThoughtOverrideUpdate(request, response, session);
  }

  if (request.method === "POST" && url.pathname === "/api/tool-parsing-mode") {
    return handleToolParsingModeUpdate(request, response, session);
  }

  if (request.method === "GET" && url.pathname === "/api/api-keys") {
    sendJson(response, 200, {
      apiKeys: listApiKeysForOwner(session.ownerId)
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/api-keys") {
    const body = await readJsonRequest(request);
    let account;

    try {
      account = resolveApiKeyAccount(session, body.accountId);
    } catch (error) {
      sendError(response, 400, error.message);
      return true;
    }

    if (!account) {
      sendError(response, 404, "Account not found");
      return true;
    }

    const result = createApiKeyRecord({
      ownerId: session.ownerId,
      accountId: account.id,
      label: body.label || resolveAccountLabel(account),
      plainKey: body.plainKey || "",
      toolCallsEnabled: body.toolCallsEnabled
    });

    sendJson(response, 200, result);
    return true;
  }

  if (request.method === "PATCH" && url.pathname.startsWith("/api/api-keys/")) {
    const body = await readJsonRequest(request);
    const apiKey = updateApiKeyRecord(session.ownerId, url.pathname.split("/").pop(), {
      toolCallsEnabled: body.toolCallsEnabled
    });

    if (!apiKey) {
      sendError(response, 404, "API key not found");
      return true;
    }

    sendJson(response, 200, { apiKey });
    return true;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/api-keys/")) {
    deleteApiKeyRecord(session.ownerId, url.pathname.split("/").pop());
    sendJson(response, 200, { ok: true });
    return true;
  }

  return false;
}
