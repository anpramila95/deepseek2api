import { createChatSession, deleteChatSession } from "./chat-session-service.js";
import { consumeDeepseekCompletion } from "./deepseek-completion-stream.js";
import { uploadOpenAiVisionFiles } from "./deepseek-file-service.js";
import { startDeepseekChatCompletion } from "./deepseek-chat-response.js";

function startCompletion({ account, inputContentLimit, requestOptions, sessionId }) {
  return startDeepseekChatCompletion({
    account,
    inputContentLimit,
    body: {
      chat_session_id: sessionId,
      parent_message_id: null,
      model_type: requestOptions.model.modelType,
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

async function withCompletionSession({ account, deleteAfterFinish, onComplete }) {
  const sessionId = await createChatSession(account);

  // Keep an incognito session alive when the upstream stream is incomplete
  // or failed.  The completion consumer only marks `completed: true` after a
  // close/full-message response has been observed (including any automatic
  // resume/continue attempts), so cleanup cannot erase a recoverable chat.
  const result = await onComplete(sessionId);
  if (deleteAfterFinish && result?.completed === true) {
    await deleteChatSession(result.refreshedAccount ?? account, sessionId);
  }

  return result;
}

export async function collectCompletionContent({
  account,
  deleteAfterFinish = false,
  inputContentLimit,
  requestOptions
}) {
  return withCompletionSession({
    account,
    deleteAfterFinish,
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
  inputContentLimit,
  onDelta,
  onText,
  requestOptions
}) {
  return withCompletionSession({
    account,
    deleteAfterFinish,
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
