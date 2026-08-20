import { getApiKeyRecord, recordApiKeyUsage } from "../services/api-key-service.js";
import {
  takeNextRoundRobinAccount,
  takeRoundRobinAccount
} from "../services/account-rotation-service.js";
import { isIncognitoEnabledForOwner } from "../services/incognito-service.js";
import { collectOpenAiResponse, streamOpenAiResponse } from "../services/openai-bridge.js";
import { listOpenAiModels } from "../services/openai-request.js";
import { recordRequestLog } from "../services/request-log-service.js";
import { isToolParsingModeEnabledForOwner } from "../services/tool-parsing-mode-service.js";
import { withOwnerRequestLimit } from "../services/request-limit-service.js";
import { parseJsonBody, readRequestBody, sendError, sendJson } from "../utils/http.js";

function getBearerToken(request) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? "");
  return match ? match[1].trim() : "";
}

function isModelsPath(pathname) {
  return pathname === "/models" || pathname === "/models/" ||
    pathname === "/v1/models" || pathname === "/v1/models/";
}

function isChatCompletionsPath(pathname) {
  return pathname === "/v1/chat/completions" || pathname === "/v1/chat/completions/";
}

function resolveLimitStatus(error) {
  return error.code === "USER_DISABLED" ? 403 : 429;
}

function handleOpenAiError(response, error) {
  if (response.headersSent || response.writableEnded || response.destroyed) {
    if (response.headersSent && !response.writableEnded && !response.destroyed) {
      response.end();
    }
    return true;
  }

  if (error.code === "USER_DISABLED" || error.code === "REQUEST_LIMIT") {
    sendError(response, resolveLimitStatus(error), error.message);
    return true;
  }

  if (error instanceof SyntaxError) {
    sendError(response, 400, "Invalid JSON body");
    return true;
  }

  if (error.statusCode) {
    sendError(response, error.statusCode, error.message);
    return true;
  }

  return false;
}

async function handleModelsRequest(response, apiKeyRecord) {
  await withOwnerRequestLimit(apiKeyRecord.ownerId, async () => {
    sendJson(response, 200, {
      object: "list",
      data: listOpenAiModels()
    });
  });
}

async function handleChatCompletionsRequest(request, response, apiKeyRecord) {
  await withOwnerRequestLimit(apiKeyRecord.ownerId, async () => {
    const startedAt = Date.now();
    const body = parseJsonBody(await readRequestBody(request)) ?? {};
    let account = takeRoundRobinAccount(apiKeyRecord);
    if (!account) {
      recordRequestLog({
        method: "POST",
        path: "/v1/chat/completions",
        model: body.model,
        ownerId: apiKeyRecord.ownerId,
        status: 404,
        durationMs: Date.now() - startedAt,
        error: "Account not found"
      });
      sendError(response, 404, "Account not found");
      return;
    }

    const deleteAfterFinish = isIncognitoEnabledForOwner(apiKeyRecord.ownerId);
    const toolParsingModeEnabled = isToolParsingModeEnabledForOwner(apiKeyRecord.ownerId);
    const selectNextAccount = (currentAccount) => {
      account = takeNextRoundRobinAccount(apiKeyRecord, currentAccount?.id) ?? currentAccount;
      return account;
    };
    try {
      if (body.stream) {
        await streamOpenAiResponse({
          response,
          account,
          body,
          deleteAfterFinish,
          ownerId: apiKeyRecord.ownerId,
          selectNextAccount,
          toolCallsEnabled: apiKeyRecord.toolCallsEnabled,
          toolParsingModeEnabled
        });
        recordRequestLog({
          method: "POST",
          path: "/v1/chat/completions",
          model: body.model,
          ownerId: apiKeyRecord.ownerId,
          accountId: account.id,
          status: 200,
          durationMs: Date.now() - startedAt
        });
        return;
      }

      const payload = await collectOpenAiResponse({
        account,
        body,
        deleteAfterFinish,
        ownerId: apiKeyRecord.ownerId,
        selectNextAccount,
        toolCallsEnabled: apiKeyRecord.toolCallsEnabled,
        toolParsingModeEnabled
      });
      sendJson(response, 200, payload);
      recordRequestLog({
        method: "POST",
        path: "/v1/chat/completions",
        model: body.model,
        ownerId: apiKeyRecord.ownerId,
        accountId: account.id,
        status: 200,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      recordRequestLog({
        method: "POST",
        path: "/v1/chat/completions",
        model: body.model,
        ownerId: apiKeyRecord.ownerId,
        accountId: account.id,
        status: error.statusCode ?? 500,
        durationMs: Date.now() - startedAt,
        error: error.message
      });
      throw error;
    }
  });
}

export async function handleOpenAiRequest(request, response, url) {
  const apiKey = getBearerToken(request);
  const apiKeyRecord = apiKey ? getApiKeyRecord(apiKey) : null;

  if (!apiKeyRecord) {
    sendError(response, 401, "Invalid API key");
    return true;
  }

  try {
    if (request.method === "GET" && isModelsPath(url.pathname)) {
      recordApiKeyUsage(apiKeyRecord.id);
      await handleModelsRequest(response, apiKeyRecord);
      return true;
    }

    if (request.method === "POST" && isChatCompletionsPath(url.pathname)) {
      recordApiKeyUsage(apiKeyRecord.id);
      await handleChatCompletionsRequest(request, response, apiKeyRecord);
      return true;
    }
  } catch (error) {
    if (!handleOpenAiError(response, error)) {
      throw error;
    }
    return true;
  }

  return false;
}
