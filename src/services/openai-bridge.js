import { randomUUID } from "node:crypto";

import { isChainOfThoughtOverrideEnabledForOwner } from "./chain-of-thought-override-service.js";
import { collectCompletionContent, streamCompletionContent } from "./openai-completion-runner.js";
import { assertNoLegacySearchOptions, resolveOpenAiModel } from "./openai-request.js";
import { appendExpertPromptSuffix } from "./expert-prompt-service.js";
import { withDeepseekMessageFrequencyRetry } from "./deepseek-frequency-retry.js";
import { createToolSieve, extractToolAwareOutput } from "./openai-tool-sieve.js";
import { buildOpenAiPrompt } from "./openai-tool-prompt.js";
import { applyToolParsingMode } from "./openai-tool-parsing-mode.js";
import { ensureToolChoiceSatisfied, hasChatToolingRequest } from "./openai-tool-policy.js";
import { createOpenAiError } from "./openai-error.js";

function createCompletionId() {
  return `chatcmpl_${randomUUID()}`;
}

function createChatToolCalls(calls, startIndex = 0) {
  return calls.map((call, offset) => ({
    index: startIndex + offset,
    id: call.id,
    type: "function",
    function: {
      name: call.name,
      arguments: call.argumentsText
    }
  }));
}

function extractImageInputs(messages) {
  return (messages ?? []).flatMap((message) => {
    if (!Array.isArray(message?.content)) {
      return [];
    }

    return message.content.flatMap((part) => {
      if (part?.type !== "image_url") {
        return [];
      }

      const imageUrl = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      return imageUrl ? [{ url: imageUrl, detail: part.image_url?.detail ?? "auto" }] : [];
    });
  });
}

export function resolveCompletionRequest({ body, ownerId, toolCallsEnabled }) {
  assertNoLegacySearchOptions(body);

  if (!toolCallsEnabled && hasChatToolingRequest(body)) {
    throw createOpenAiError(400, "Tool calls are disabled for this API key");
  }

  const model = resolveOpenAiModel(body?.model);
  const imageInputs = extractImageInputs(body?.messages ?? []);
  const refFileIds = Array.isArray(body?.ref_file_ids) ? body.ref_file_ids.filter(Boolean) : [];

  if ((imageInputs.length || refFileIds.length) && model.supportsUploads === false) {
    throw createOpenAiError(400, "Expert models do not support file or image uploads");
  }

  if (imageInputs.length && model.modelType !== "vision") {
    throw createOpenAiError(400, "Image inputs require deepseek-vision or deepseek-vision-reasoner");
  }

  const promptRequest = buildOpenAiPrompt({
    messages: body?.messages ?? [],
    toolChoice: toolCallsEnabled ? body?.tool_choice : undefined,
    tools: toolCallsEnabled ? body?.tools ?? [] : []
  });
  const prompt = appendExpertPromptSuffix(promptRequest.prompt, {
    modelType: model.modelType,
    enabled: isChainOfThoughtOverrideEnabledForOwner(ownerId)
  });

  return {
    model,
    prompt,
    imageInputs,
    toolPrompt: promptRequest.toolPrompt,
    toolChoicePolicy: promptRequest.toolChoicePolicy,
    toolNames: promptRequest.toolNames
  };
}

function buildAssistantMessage(requestOptions, message, reasoningContent) {
  if (!requestOptions.model.thinkingEnabled && !reasoningContent) {
    return message;
  }

  return {
    ...message,
    reasoning_content: reasoningContent
  };
}

export function buildChatCompletionPayload(completionId, requestOptions, completion) {
  const { content, reasoningContent } = completion;
  const parsed = requestOptions.toolNames.length
    ? extractToolAwareOutput(content, requestOptions.toolNames)
    : { content, toolCalls: [] };

  ensureToolChoiceSatisfied(requestOptions.toolChoicePolicy, parsed.toolCalls);

  if (parsed.toolCalls.length) {
    return {
      id: completionId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestOptions.model.id,
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: buildAssistantMessage(requestOptions, {
            role: "assistant",
            content: parsed.content.length ? parsed.content : null,
            tool_calls: createChatToolCalls(parsed.toolCalls)
          }, reasoningContent)
        }
      ]
    };
  }

  return {
    id: completionId,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestOptions.model.id,
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: buildAssistantMessage(requestOptions, {
          role: "assistant",
          content: parsed.content
        }, reasoningContent)
      }
    ]
  };
}

export function buildChunkPayload(completionId, model, delta, finishReason) {
  const choice = finishReason
    ? { index: 0, delta: {}, finish_reason: finishReason }
    : { index: 0, delta };

  return {
    id: completionId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [choice]
  };
}

function writeSseChunk(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeSseHeartbeat(response) {
  if (!response.destroyed && !response.writableEnded) {
    response.write(": keep-alive\n\n");
  }
}

export function buildOpenAiTextDelta(delta) {
  return delta.kind === "thinking"
    ? { reasoning_content: delta.text }
    : { content: delta.text };
}

function startSseHeartbeat(response, intervalMs = 10_000) {
  const timer = setInterval(() => {
    writeSseHeartbeat(response);
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export async function collectOpenAiResponse({
  account,
  body,
  deleteAfterFinish = false,
  maxFrequencyRetries,
  onFrequencyRetry,
  ownerId,
  retryDelayMs,
  retrySleep,
  selectNextAccount,
  toolCallsEnabled = false,
  toolParsingModeEnabled = false
}) {
  const requestOptions = resolveCompletionRequest({ body, ownerId, toolCallsEnabled });
  const completion = await withDeepseekMessageFrequencyRetry({
    account,
    maxRetries: maxFrequencyRetries,
    onRetry: onFrequencyRetry,
    operation: async (activeAccount) => {
      const initialCompletion = await collectCompletionContent({
        account: activeAccount,
        deleteAfterFinish,
        requestOptions
      });
      return applyToolParsingMode({
        account: activeAccount,
        completion: initialCompletion,
        enabled: toolParsingModeEnabled,
        requestOptions
      });
    },
    retryDelayMs,
    selectNextAccount,
    sleep: retrySleep
  });

  return buildChatCompletionPayload(createCompletionId(), requestOptions, completion);
}

export async function streamOpenAiResponse(options) {
  const {
    account,
    body,
    deleteAfterFinish = false,
    heartbeatIntervalMs,
    maxFrequencyRetries,
    onFrequencyRetry,
    ownerId,
    response,
    retryDelayMs,
    retrySleep,
    selectNextAccount,
    toolCallsEnabled = false,
    toolParsingModeEnabled = false
  } = options;
  const completionId = createCompletionId();
  const requestOptions = resolveCompletionRequest({ body, ownerId, toolCallsEnabled });
  const toolSieve = requestOptions.toolNames.length
    ? createToolSieve(requestOptions.toolNames)
    : null;
  let toolCallIndex = 0;
  let sawToolCall = false;

  response.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no"
  });
  response.flushHeaders?.();

  writeSseChunk(response, buildChunkPayload(
    completionId,
    requestOptions.model.id,
    { role: "assistant" }
  ));

  const emitToolCalls = (calls) => {
    if (!calls.length) {
      return;
    }

    sawToolCall = true;
    writeSseChunk(response, buildChunkPayload(
      completionId,
      requestOptions.model.id,
      { tool_calls: createChatToolCalls(calls, toolCallIndex) }
    ));
    toolCallIndex += calls.length;
  };

  const finishStream = () => {
    writeSseChunk(response, buildChunkPayload(
      completionId,
      requestOptions.model.id,
      {},
      sawToolCall ? "tool_calls" : "stop"
    ));
    response.end("data: [DONE]\n\n");
  };

  const emitBufferedCompletion = (completion) => {
    if (completion.reasoningContent) {
      writeSseChunk(response, buildChunkPayload(
        completionId,
        requestOptions.model.id,
        { reasoning_content: completion.reasoningContent }
      ));
    }

    const parsed = requestOptions.toolNames.length
      ? extractToolAwareOutput(completion.content, requestOptions.toolNames)
      : { content: completion.content, toolCalls: [] };
    ensureToolChoiceSatisfied(requestOptions.toolChoicePolicy, parsed.toolCalls);

    if (parsed.content) {
      writeSseChunk(response, buildChunkPayload(
        completionId,
        requestOptions.model.id,
        { content: parsed.content }
      ));
    }
    emitToolCalls(parsed.toolCalls);
  };

  const stopHeartbeat = startSseHeartbeat(response, heartbeatIntervalMs);
  const handleFrequencyRetry = async (retry) => {
    writeSseHeartbeat(response);
    await onFrequencyRetry?.(retry);
  };
  try {
    if (toolParsingModeEnabled && requestOptions.toolNames.length) {
      const completion = await withDeepseekMessageFrequencyRetry({
        account,
        maxRetries: maxFrequencyRetries,
        onRetry: handleFrequencyRetry,
        operation: async (activeAccount) => {
          const initialCompletion = await collectCompletionContent({
            account: activeAccount,
            deleteAfterFinish,
            requestOptions
          });
          return applyToolParsingMode({
            account: activeAccount,
            completion: initialCompletion,
            enabled: true,
            requestOptions
          });
        },
        retryDelayMs,
        selectNextAccount,
        sleep: retrySleep
      });

      emitBufferedCompletion(completion);
      finishStream();
      return;
    }

    await withDeepseekMessageFrequencyRetry({
      account,
      maxRetries: maxFrequencyRetries,
      onRetry: handleFrequencyRetry,
      operation: (activeAccount) => streamCompletionContent({
        account: activeAccount,
        deleteAfterFinish,
        onDelta: (delta) => {
          if (delta.kind === "thinking") {
            writeSseChunk(response, buildChunkPayload(
              completionId,
              requestOptions.model.id,
              buildOpenAiTextDelta(delta)
            ));
            return;
          }

          if (!toolSieve) {
            writeSseChunk(response, buildChunkPayload(
              completionId,
              requestOptions.model.id,
              buildOpenAiTextDelta(delta)
            ));
            return;
          }

          const events = toolSieve.push(delta.text);
          events.forEach((event) => {
            if (event.type === "tool_calls") {
              emitToolCalls(event.calls ?? []);
              return;
            }

            if (event.text) {
              writeSseChunk(response, buildChunkPayload(
                completionId,
                requestOptions.model.id,
                { content: event.text }
              ));
            }
          });
        },
        requestOptions
      }),
      retryDelayMs,
      selectNextAccount,
      sleep: retrySleep
    });

    if (toolSieve) {
      const tailEvents = toolSieve.flush();
      tailEvents.forEach((event) => {
        if (event.type === "tool_calls") {
          emitToolCalls(event.calls ?? []);
          return;
        }

        if (event.text) {
          writeSseChunk(response, buildChunkPayload(
            completionId,
            requestOptions.model.id,
            { content: event.text }
          ));
        }
      });
    }

    finishStream();
  } catch (error) {
    if (!response.writableEnded && !response.destroyed) {
      writeSseChunk(response, {
        error: {
          message: error.message,
          type: "upstream_error"
        }
      });
      response.end("data: [DONE]\n\n");
    }
    error.responseStarted = true;
    throw error;
  } finally {
    stopHeartbeat();
  }
}
