import { createChatSession, deleteChatSession } from "./chat-session-service.js";
import { consumeDeepseekCompletion } from "./deepseek-completion-stream.js";
import { uploadOpenAiVisionFiles } from "./deepseek-file-service.js";
import { startDeepseekChatCompletion } from "./deepseek-chat-response.js";
import { updatePromptCacheSession } from "./prompt-cache-service.js";

function startCompletion({ account, inputContentLimit, requestOptions, sessionId }) {
  return startDeepseekChatCompletion({
    account,
    inputContentLimit,
    body: {
      chat_session_id: sessionId,
      parent_message_id: null,
      //model_type: requestOptions.model.modelType,
      model_type: null,
      prompt: requestOptions.prompt,
      ref_file_ids: requestOptions.refFileIds ?? [],
      thinking_enabled: requestOptions.model.thinkingEnabled,
      search_enabled: requestOptions.model.searchEnabled,
      action: null,
      preempt: false
    }
  });
}

async function prepareRequestOptions({ account, requestOptions, sessionId }) {
  if (!requestOptions.imageInputs?.length) {
    return { ...requestOptions, refFileIds: requestOptions.refFileIds ?? [] };
  }

  const refFileIds = await uploadOpenAiVisionFiles({
    account,
    imageInputs: requestOptions.imageInputs,
    sessionId
  });

  return {
    ...requestOptions,
    refFileIds: [...(requestOptions.refFileIds ?? []), ...refFileIds]
  };
}

async function withCompletionSession({ account, deleteAfterFinish, explicitSessionId, onComplete, promptCacheKey }) {
  let sessionId = explicitSessionId;
  if (!sessionId) {
    sessionId = await createChatSession(account);
  }

  let result;
  try {
    result = await onComplete(sessionId);
  } catch (error) {
    const msg = String(error?.message ?? "").toLowerCase();
    const isSessionNotFound =
      error.statusCode === 400 ||
      error.statusCode === 404 ||
      error.statusCode === 502 ||
      /invalid.*(?:chat_)?session|session.*invalid|session.*not.*found|session.*deleted|chat_session_id/i.test(msg);

    if (explicitSessionId && isSessionNotFound) {
      console.warn(`[PromptCache] Session ${explicitSessionId} invalid (${error.message}), recreating new session and retrying...`);
      sessionId = await createChatSession(account);
      if (promptCacheKey) {
        updatePromptCacheSession(promptCacheKey, account.id, sessionId);
      }
      result = await onComplete(sessionId);
    } else {
      throw error;
    }
  }

  if (deleteAfterFinish && !explicitSessionId && result?.completed === true) {
    await deleteChatSession(result.refreshedAccount ?? account, sessionId);
  }

  return result;
}

export async function collectCompletionContent({
  account,
  deleteAfterFinish = false,
  explicitSessionId,
  inputContentLimit,
  promptCacheKey,
  requestOptions
}) {
  return withCompletionSession({
    account,
    deleteAfterFinish,
    explicitSessionId,
    promptCacheKey,
    onComplete: async (sessionId) => {
      const preparedOptions = await prepareRequestOptions({ account, requestOptions, sessionId });
      const { refreshedAccount, response } = await startCompletion({
        account,
        inputContentLimit,
        requestOptions: preparedOptions,
        sessionId
      });
      return consumeDeepseekCompletion({
        account: refreshedAccount ?? account,
        response,
        sessionId
      });
    }
  });
}

export async function streamCompletionContent({
  account,
  deleteAfterFinish = false,
  explicitSessionId,
  inputContentLimit,
  onDelta,
  onText,
  promptCacheKey,
  requestOptions
}) {
  return withCompletionSession({
    account,
    deleteAfterFinish,
    explicitSessionId,
    promptCacheKey,
    onComplete: async (sessionId) => {
      const preparedOptions = await prepareRequestOptions({ account, requestOptions, sessionId });
      const { refreshedAccount, response } = await startCompletion({
        account,
        inputContentLimit,
        requestOptions: preparedOptions,
        sessionId
      });
      return consumeDeepseekCompletion({
        account: refreshedAccount ?? account,
        onDelta: onDelta ?? (onText ? (delta) => onText(delta.text) : undefined),
        response,
        sessionId
      });
    }
  });
}
