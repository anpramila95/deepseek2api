import { getApiKeyRecord, recordApiKeyUsage } from "../services/api-key-service.js";
import {
  takeNextRoundRobinAccount,
  takeRoundRobinAccount
} from "../services/account-rotation-service.js";
import { resolvePromptCacheSession } from "../services/prompt-cache-service.js";
import { isIncognitoEnabledForOwner } from "../services/incognito-service.js";
import { collectOpenAiResponse, streamOpenAiResponse } from "../services/openai-bridge.js";
import { listOpenAiModels } from "../services/openai-request.js";
import { recordRequestLog } from "../services/request-log-service.js";
import { isToolParsingModeEnabledForOwner } from "../services/tool-parsing-mode-service.js";
import { synthesizeSpeech, resolveAudioContentType } from "../services/deepseek-tts-service.js";
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

function estimateUsage(body, payload = null) {
  const promptTokens = Math.ceil(JSON.stringify(body?.messages ?? []).length / 4);
  const completionTokens = Number(payload?.usage?.completion_tokens) || 0;
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

function isChatCompletionsPath(pathname) {
  return pathname === "/v1/chat/completions" || pathname === "/v1/chat/completions/";
}

function isSpeechPath(pathname) {
  return pathname === "/v1/audio/speech" || pathname === "/v1/audio/speech/";
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

    const promptCacheKey = body.prompt_cache_key || body.prompt_cache_id || null;
    let explicitSessionId = null;

    let account = null;
    if (promptCacheKey) {
      const cachedSession = await resolvePromptCacheSession({
        accountPicker: () => takeRoundRobinAccount(apiKeyRecord),
        cacheKey: promptCacheKey,
      });
      if (cachedSession) {
        account = cachedSession.account;
        explicitSessionId = cachedSession.sessionId;
      }
    }

    if (!account) {
      account = takeRoundRobinAccount(apiKeyRecord);
    }
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
          explicitSessionId,
          ownerId: apiKeyRecord.ownerId,
          promptCacheKey,
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
          durationMs: Date.now() - startedAt,
          usage: estimateUsage(body)
        });
        return;
      }

      const payload = await collectOpenAiResponse({
        account,
        body,
        deleteAfterFinish,
        explicitSessionId,
        ownerId: apiKeyRecord.ownerId,
        promptCacheKey,
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
        durationMs: Date.now() - startedAt,
        usage: estimateUsage(body, payload)
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

async function handleSpeechRequest(request, response, apiKeyRecord) {
  await withOwnerRequestLimit(apiKeyRecord.ownerId, async () => {
    const startedAt = Date.now();
    const body = parseJsonBody(await readRequestBody(request)) ?? {};

    const prompt = (body.prompt ?? body.input ?? "").trim();
    if (!prompt) {
      sendError(response, 400, "Missing required field: prompt or input");
      return;
    }

    const account = takeRoundRobinAccount(apiKeyRecord);
    if (!account) {
      recordRequestLog({
        method: "POST",
        path: "/v1/audio/speech",
        model: body.model || "tts-1",
        ownerId: apiKeyRecord.ownerId,
        status: 404,
        durationMs: Date.now() - startedAt,
        error: "Account not found"
      });
      sendError(response, 404, "Account not found");
      return;
    }

    const voice = body.voice ?? body.voice_id ?? "echo";
    const rawFormat = String(body.response_format ?? body.format ?? "opus").toLowerCase();
    const isBase64Response = rawFormat === "b64" || rawFormat === "base64";
    const format = isBase64Response ? "opus" : rawFormat;

    try {
      const { audioBuffer, format: resolvedFormat } = await synthesizeSpeech({
        account,
        prompt,
        voice,
        format
      });

      if (isBase64Response) {
        sendJson(response, 200, {
          audio: audioBuffer.toString("base64")
        });
      } else {
        const contentType = resolveAudioContentType(resolvedFormat);
        const ext = resolvedFormat === "mp3" ? "mp3" : (resolvedFormat === "wav" ? "wav" : "ogg");
        response.writeHead(200, {
          "content-type": contentType,
          "content-length": audioBuffer.length,
          "accept-ranges": "bytes",
          "content-disposition": `inline; filename="speech.${ext}"`
        });
        response.end(audioBuffer);
      }

      recordRequestLog({
        method: "POST",
        path: "/v1/audio/speech",
        model: body.model || "tts-1",
        ownerId: apiKeyRecord.ownerId,
        accountId: account.id,
        status: 200,
        durationMs: Date.now() - startedAt,
        usage: {
          promptTokens: Math.ceil(prompt.length / 4),
          completionTokens: 0,
          totalTokens: Math.ceil(prompt.length / 4)
        }
      });
    } catch (error) {
      recordRequestLog({
        method: "POST",
        path: "/v1/audio/speech",
        model: body.model || "tts-1",
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

    if (request.method === "POST" && isSpeechPath(url.pathname)) {
      recordApiKeyUsage(apiKeyRecord.id);
      await handleSpeechRequest(request, response, apiKeyRecord);
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
