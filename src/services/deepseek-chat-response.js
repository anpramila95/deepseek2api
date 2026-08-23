import { consumeDeepseekCompletion } from "./deepseek-completion-stream.js";
import { proxyDeepseekRequest } from "./deepseek-proxy.js";

const COMPLETION_PATH = "/chat/completion";
const JSON_HEADERS = Object.freeze({ "content-type": "application/json" });

const STREAM_CONTENT_TYPE = "text/event-stream";

function appendSection(sections, delta) {
  if (!delta?.text) {
    return sections;
  }

  const lastSection = sections.at(-1);
  if (lastSection?.kind === delta.kind) {
    return [
      ...sections.slice(0, -1),
      {
        ...lastSection,
        content: lastSection.content + delta.text
      }
    ];
  }

  return [...sections, { kind: delta.kind, content: delta.text }];
}

function createCollectedPayload({ readyPayload, result, sections: providedSections }) {
  const sections = providedSections ?? [
    ...(result.reasoningContent ? [{ kind: "thinking", content: result.reasoningContent }] : []),
    ...(result.content ? [{ kind: "response", content: result.content }] : [])
  ];

  return {
    code: 0,
    msg: "",
    data: {
      biz_code: 0,
      biz_msg: "",
      biz_data: {
        ready: readyPayload,
        response_message_id: result.responseMessageId ?? readyPayload?.response_message_id ?? null,
        message: {
          role: "ASSISTANT",
          status: result.status ?? null,
          sections
        }
      }
    }
  };
}

export function sanitizeChatCompletionBody(body) {
  const payload = { ...(body ?? {}) };
  delete payload.stream;
  return payload;
}

export function createChatCompletionRequestBody(body) {
  return Buffer.from(JSON.stringify(sanitizeChatCompletionBody(body)));
}

export async function startDeepseekChatCompletion({ account, body }) {
  const sanitized = sanitizeChatCompletionBody(body);
  return proxyDeepseekRequest({
    account,
    method: "POST",
    path: COMPLETION_PATH,
    body: Buffer.from(JSON.stringify(sanitized)),
    headers: JSON_HEADERS
  });
}

export async function collectDeepseekChatResponse({ account, body }) {
  const { refreshedAccount, response } = await startDeepseekChatCompletion({ account, body });

  let readyPayload = null;
  let sections = [];
  const result = await consumeDeepseekCompletion({
    account: refreshedAccount ?? account,
    onDelta: (delta) => {
      sections = appendSection(sections, delta);
    },
    onReady: (payload) => {
      readyPayload = payload;
    },
    response,
    sessionId: body?.chat_session_id
  });

  return {
    completed: result.completed === true,
    refreshedAccount: result.refreshedAccount ?? refreshedAccount ?? account,
    result,
    payload: createCollectedPayload({ readyPayload, result, sections })
  };
}

function writeSseEvent(response, event, payload) {
  if (event) {
    response.write(`event: ${event}\n`);
  }
  if (payload !== undefined) {
    response.write(`data: ${JSON.stringify(payload)}\n`);
  }
  response.write("\n");
}

/**
 * Stream a chat completion through the protocol-aware consumer. The public
 * proxy receives a single logical stream even when the upstream requires
 * one or more resume/continue requests.
 */
export async function streamDeepseekChatResponse({ account, body, response }) {
  const { refreshedAccount, response: upstream } = await startDeepseekChatCompletion({
    account,
    body
  });
  const contentType = upstream.headers.get("content-type") ?? "";

  if (!contentType.includes(STREAM_CONTENT_TYPE)) {
    const result = await consumeDeepseekCompletion({
      account: refreshedAccount ?? account,
      response: upstream,
      sessionId: body?.chat_session_id
    });
    return {
      completed: result.completed === true,
      refreshedAccount: result.refreshedAccount ?? refreshedAccount ?? account,
      result,
      payload: createCollectedPayload({ readyPayload: null, result })
    };
  }

  response.writeHead(upstream.status, {
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no"
  });
  response.flushHeaders?.();

  let readyPayload = null;
  let result;
  try {
    result = await consumeDeepseekCompletion({
      account: refreshedAccount ?? account,
      onDelta: (delta) => {
        const path = delta.kind === "thinking"
          ? "response/thinking_content"
          : "response/content";
        response.write(`data: ${JSON.stringify({ p: path, o: "APPEND", v: delta.text })}\n\n`);
      },
      onReady: (payload) => {
        if (readyPayload) {
          return;
        }
        readyPayload = payload;
        writeSseEvent(response, "ready", payload);
      },
      response: upstream,
      sessionId: body?.chat_session_id
    });
  } catch (error) {
    if (!response.writableEnded && !response.destroyed) {
      writeSseEvent(response, "hint", {
        type: "error",
        content: error.message,
        clear_response: false,
        finish_reason: null
      });
      writeSseEvent(response, "close", { click_behavior: "retry" });
      response.end();
    }
    error.responseStarted = true;
    throw error;
  }

  writeSseEvent(response, "finish", {});
  writeSseEvent(response, "close", { click_behavior: "none" });
  response.end();

  return {
    completed: result.completed === true,
    refreshedAccount: result.refreshedAccount ?? refreshedAccount ?? account,
    result,
    payload: createCollectedPayload({ readyPayload, result })
  };
}
