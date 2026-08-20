import { resolveDeepseekApiPath } from "../config.js";
import { resolveScopedAccount, resolveSession } from "../services/auth-service.js";
import { deleteChatSession } from "../services/chat-session-service.js";
import {
  collectDeepseekChatResponse,
  createChatCompletionRequestBody,
  sanitizeChatCompletionBody,
  streamDeepseekChatResponse
} from "../services/deepseek-chat-response.js";
import { isChainOfThoughtOverrideEnabledForOwner } from "../services/chain-of-thought-override-service.js";
import { isIncognitoEnabledForOwner } from "../services/incognito-service.js";
import { proxyDeepseekRequest } from "../services/deepseek-proxy.js";
import { appendExpertPromptSuffixToPayload } from "../services/expert-prompt-service.js";
import { recordRequestLog } from "../services/request-log-service.js";
import { withOwnerRequestLimit } from "../services/request-limit-service.js";
import { parseJsonBody, readRequestBody, sendError, sendJson } from "../utils/http.js";

const CHAT_COMPLETION_PATH = resolveDeepseekApiPath("/chat/completion");

function resolveLimitStatus(error) {
  return error.code === "USER_DISABLED" ? 403 : 429;
}

function getForwardHeaders(request) {
  const headers = {};
  const contentType = request.headers["content-type"];
  const accept = request.headers.accept;

  if (contentType) {
    headers["content-type"] = contentType;
  }

  if (accept) {
    headers.accept = accept;
  }

  return headers;
}

function getResponseHeaders(upstream) {
  const headers = Object.fromEntries(upstream.headers.entries());
  delete headers["content-encoding"];
  delete headers["content-length"];
  delete headers.connection;
  delete headers["keep-alive"];
  delete headers["set-cookie"];
  delete headers["set-cookie2"];
  delete headers["transfer-encoding"];
  return headers;
}

function createStatusError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function tryParseChatCompletionBody(body) {
  if (!body?.byteLength) {
    return null;
  }

  try {
    return parseJsonBody(body);
  } catch {
    return null;
  }
}

function assertChatCompletionUploadsSupported(payload) {
  const hasFiles = Array.isArray(payload?.ref_file_ids) && payload.ref_file_ids.length > 0;
  if (payload?.model_type === "expert" && hasFiles) {
    throw createStatusError(400, "Expert mode does not support file uploads");
  }
}

export function resolveChatCompletionRequest({ body, method, ownerId, targetPath }) {
  if (method !== "POST" || targetPath !== CHAT_COMPLETION_PATH) {
    return null;
  }

  const payload = tryParseChatCompletionBody(body);
  if (!payload) {
    return null;
  }

  assertChatCompletionUploadsSupported(payload);
  const payloadWithPrompt = appendExpertPromptSuffixToPayload(payload, {
    enabled: isChainOfThoughtOverrideEnabledForOwner(ownerId)
  });

  return {
    payload: payloadWithPrompt,
    shouldStream: payloadWithPrompt.stream !== false,
    forwardedBody: createChatCompletionRequestBody(payloadWithPrompt)
  };
}

function resolveCleanupSessionId({ body, method, ownerId, targetPath }) {
  if (method !== "POST" || targetPath !== CHAT_COMPLETION_PATH) {
    return null;
  }

  if (!isIncognitoEnabledForOwner(ownerId)) {
    return null;
  }

  const chatSessionId = tryParseChatCompletionBody(body)?.chat_session_id;
  if (!chatSessionId) {
    return null;
  }

  return chatSessionId;
}

export async function cleanupCompletedChatSession({
  account,
  chatSessionId,
  completion,
  deleteSession = deleteChatSession
}) {
  if (!chatSessionId || completion?.completed !== true) {
    return false;
  }

  await deleteSession(completion.refreshedAccount ?? account, chatSessionId);
  return true;
}

async function writeUpstreamResponse({ response, upstream }) {
  response.writeHead(upstream.status, getResponseHeaders(upstream));
  response.flushHeaders?.();
  const isEventStream = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
  const heartbeat = isEventStream
    ? setInterval(() => {
        if (!response.destroyed && !response.writableEnded) {
          response.write(": keep-alive\n\n");
        }
      }, 10_000)
    : null;
  heartbeat?.unref?.();

  try {
    if (upstream.body) {
      for await (const chunk of upstream.body) {
        response.write(chunk);
      }
    }

    response.end();
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  }
}

export async function handleProxyRequest(request, response, url, allowedProxyPaths) {
  const startedAt = Date.now();
  const session = resolveSession(request);
  if (!session) {
    sendError(response, 401, "Unauthorized");
    return true;
  }

  const targetPath = resolveDeepseekApiPath(url.pathname.slice("/proxy".length));
  if (!allowedProxyPaths.has(targetPath)) {
    sendError(response, 404, "Proxy path not allowed");
    return true;
  }

  const account = resolveScopedAccount(session, request.headers["x-proxy-account-id"]);
  if (!account) {
    recordRequestLog({
      method: request.method,
      path: targetPath,
      ownerId: session.ownerId,
      status: 404,
      durationMs: Date.now() - startedAt,
      error: "Account not found"
    });
    sendError(response, 404, "Account not found");
    return true;
  }

  try {
    await withOwnerRequestLimit(session.ownerId, async () => {
      const rawBody = request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await readRequestBody(request);
      const chatCompletion = resolveChatCompletionRequest({
        body: rawBody,
        method: request.method,
        ownerId: session.ownerId,
        targetPath
      });
      const forwardedBody = chatCompletion?.forwardedBody ?? rawBody;
      const cleanupSessionId = resolveCleanupSessionId({
        body: rawBody,
        method: request.method,
        ownerId: session.ownerId,
        targetPath
      });

      if (chatCompletion && !chatCompletion.shouldStream) {
        try {
          const completion = await collectDeepseekChatResponse({
            account,
            body: sanitizeChatCompletionBody(chatCompletion.payload)
          });
          await cleanupCompletedChatSession({
            account,
            chatSessionId: cleanupSessionId,
            completion
          });
          sendJson(response, 200, completion.payload);
          recordRequestLog({
            method: request.method,
            path: targetPath,
            model: chatCompletion.payload?.model_type ?? "",
            ownerId: session.ownerId,
            accountId: account.id,
            status: 200,
            durationMs: Date.now() - startedAt
          });
          return;
        } catch (error) {
          // Keep an incognito session when collection failed or remained
          // incomplete.  The protocol consumer owns continuation/resume and
          // only returns after a complete message is confirmed.
          throw error;
        }
      }

      if (chatCompletion?.shouldStream) {
        const streamResult = await streamDeepseekChatResponse({
          account,
          body: sanitizeChatCompletionBody(chatCompletion.payload),
          response
        });

        await cleanupCompletedChatSession({
          account,
          chatSessionId: cleanupSessionId,
          completion: streamResult
        });

        if (!response.headersSent) {
          sendJson(response, 200, streamResult.payload);
        }

        recordRequestLog({
          method: request.method,
          path: targetPath,
          model: chatCompletion.payload?.model_type ?? "",
          ownerId: session.ownerId,
          accountId: account.id,
          status: 200,
          durationMs: Date.now() - startedAt
        });
        return;
      }

      const { response: upstream } = await proxyDeepseekRequest({
        account,
        method: request.method,
        path: targetPath,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: getForwardHeaders(request),
        body: forwardedBody
      });

      await writeUpstreamResponse({
        response,
        upstream
      });
      recordRequestLog({
        method: request.method,
        path: targetPath,
        ownerId: session.ownerId,
        accountId: account.id,
        status: upstream.status,
        durationMs: Date.now() - startedAt
      });
    });
  } catch (error) {
    recordRequestLog({
      method: request.method,
      path: targetPath,
      ownerId: session.ownerId,
      accountId: account.id,
      status: error.statusCode ?? resolveLimitStatus(error),
      durationMs: Date.now() - startedAt,
      error: error.message
    });

    if (error.statusCode) {
      if (!response.headersSent) {
        sendError(response, error.statusCode, error.message);
      }
      return true;
    }

    if (error.responseStarted || response.headersSent) {
      return true;
    }

    if (error.code !== "USER_DISABLED" && error.code !== "REQUEST_LIMIT") {
      throw error;
    }

    sendError(response, resolveLimitStatus(error), error.message);
  }

  return true;
}
