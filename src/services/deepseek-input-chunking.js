import { createSseParser } from "../utils/deepseek-sse.js";
import { proxyDeepseekRequest } from "./deepseek-proxy.js";
import { getSystemSettings } from "./system-settings-service.js";

const COMPLETION_PATH = "/chat/completion";
const STOP_STREAM_PATH = "/chat/stop_stream";
const JSON_HEADERS = Object.freeze({ "content-type": "application/json" });
const STOPPED_STREAM_DRAIN_TIMEOUT_MS = 15_000;

function createStatusError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createJsonBody(payload) {
  return Buffer.from(JSON.stringify(payload));
}

function sanitizeCompletionBody(body) {
  const payload = { ...(body ?? {}) };
  delete payload.stream;
  return payload;
}

function normalizeLimit(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1
    ? Math.min(10_000_000, Math.trunc(parsed))
    : getSystemSettings().inputContentLimit;
}

function avoidSplittingSurrogatePair(text, start, tentativeEnd) {
  if (tentativeEnd >= text.length || tentativeEnd <= start) {
    return tentativeEnd;
  }

  const previous = text.charCodeAt(tentativeEnd - 1);
  const next = text.charCodeAt(tentativeEnd);
  const splitsPair = previous >= 0xd800 && previous <= 0xdbff
    && next >= 0xdc00 && next <= 0xdfff;
  if (!splitsPair) {
    return tentativeEnd;
  }

  const backedUpEnd = tentativeEnd - 1;
  if (backedUpEnd > start) {
    return backedUpEnd;
  }

  // A one-code-unit limit cannot contain a surrogate pair. Keep the code
  // point intact and allow this single chunk to exceed the configured limit.
  return Math.min(text.length, tentativeEnd + 1);
}

export function splitDeepseekPrompt(prompt, inputContentLimit) {
  const text = String(prompt ?? "");
  const limit = normalizeLimit(inputContentLimit);
  if (text.length <= limit) {
    return [text];
  }

  const chunks = [];
  let offset = 0;
  while (offset < text.length) {
    const tentativeEnd = Math.min(text.length, offset + limit);
    const end = avoidSplittingSurrogatePair(text, offset, tentativeEnd);
    chunks.push(text.slice(offset, end));
    offset = end;
  }

  return chunks;
}

function extractReadyPayload(payload) {
  const source = payload?.data?.biz_data?.ready
    ?? payload?.data?.biz_data
    ?? payload?.data
    ?? payload;
  const responseMessageId = source?.response_message_id ?? source?.responseMessageId ?? null;
  const requestMessageId = source?.request_message_id ?? source?.requestMessageId ?? null;
  return { requestMessageId, responseMessageId };
}

function parseProtocolError(event, payload) {
  if (event !== "hint" && event !== "toast") {
    return null;
  }

  if (String(payload?.type ?? "").toLowerCase() !== "error") {
    return null;
  }

  return payload?.content || payload?.finish_reason || "DeepSeek completion failed before ready";
}

async function readReadyFrame(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("text/event-stream") || !response.body) {
    const text = await response.text().catch(() => "");
    throw createStatusError(
      response.ok ? 502 : response.status,
      text || "DeepSeek completion did not return an event stream"
    );
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let protocolError = null;
  let readyPayload = null;
  let sawMessageFrame = false;
  const parser = createSseParser(({ data, event }) => {
    if (!data || protocolError) {
      return;
    }

    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }

    protocolError = parseProtocolError(event, payload);
    if (event === "ready") {
      const ready = extractReadyPayload(payload);
      if (ready.responseMessageId) {
        readyPayload = ready;
      }
      return;
    }

    // Stopping immediately after `ready` is too early: DeepSeek acknowledges
    // the stop request but discards both message records, so the advertised
    // response_message_id cannot be used as the next parent_message_id.  The
    // first message/delta frame is the earliest point at which the pair is
    // persisted and can safely be chained.
    if ((event === "message" || event === "delta") && payload) {
      sawMessageFrame = true;
    }
  });

  try {
    while ((!readyPayload || !sawMessageFrame) && !protocolError) {
      const { done, value } = await reader.read();
      if (done) {
        parser.push(decoder.decode());
        parser.flush();
        break;
      }
      parser.push(decoder.decode(value, { stream: true }));
    }

    if (protocolError) {
      throw createStatusError(502, protocolError);
    }
    if (!readyPayload?.responseMessageId) {
      throw createStatusError(502, "DeepSeek completion ended before the ready message identifier");
    }
    if (!sawMessageFrame) {
      throw createStatusError(502, "DeepSeek completion ended before the first persisted message frame");
    }

    return { ...readyPayload, reader };
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
}

async function drainStoppedStream(reader) {
  let timeoutId;
  const drained = (async () => {
    while (true) {
      const { done } = await reader.read();
      if (done) {
        return;
      }
    }
  })();
  const timedOut = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(createStatusError(504, "DeepSeek stopped stream did not close in time"));
    }, STOPPED_STREAM_DRAIN_TIMEOUT_MS);
    timeoutId.unref?.();
  });

  try {
    await Promise.race([drained, timedOut]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function stopDeepseekCompletion({ account, messageId, sessionId }) {
  const { refreshedAccount, response } = await proxyDeepseekRequest({
    account,
    method: "POST",
    path: STOP_STREAM_PATH,
    body: createJsonBody({
      chat_session_id: sessionId,
      message_id: messageId
    }),
    headers: JSON_HEADERS
  });
  const responseText = await response.text().catch(() => "");
  let payload = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      if (!response.ok) {
        throw createStatusError(response.status, responseText);
      }
    }
  }

  const globalCode = payload?.code;
  const bizCode = payload?.data?.biz_code;
  if (
    !response.ok
    || (typeof globalCode === "number" && globalCode !== 0)
    || (typeof bizCode === "number" && bizCode !== 0)
  ) {
    throw createStatusError(
      response.ok ? 502 : response.status,
      payload?.data?.biz_msg || payload?.msg || "DeepSeek stop stream failed"
    );
  }

  return refreshedAccount ?? account;
}

function createSegmentBody(baseBody, chunk, index, lastIndex, parentMessageId) {
  const isFinal = index === lastIndex;
  return {
    ...baseBody,
    parent_message_id: parentMessageId,
    model_type: index === 0 ? baseBody.model_type : null,
    prompt: chunk,
    ref_file_ids: isFinal ? (baseBody.ref_file_ids ?? []) : [],
    preempt: index === 0 ? Boolean(baseBody.preempt) : false
  };
}

async function startCompletionRequest({ account, body }) {
  return proxyDeepseekRequest({
    account,
    method: "POST",
    path: COMPLETION_PATH,
    body: createJsonBody(body),
    headers: JSON_HEADERS
  });
}

export async function startChunkedDeepseekCompletion({
  account,
  body,
  inputContentLimit = getSystemSettings().inputContentLimit
}) {
  const baseBody = sanitizeCompletionBody(body);
  const chunks = splitDeepseekPrompt(baseBody.prompt, inputContentLimit);
  const lastIndex = chunks.length - 1;
  let activeAccount = account;
  let parentMessageId = baseBody.parent_message_id ?? null;

  for (let index = 0; index < lastIndex; index += 1) {
    const segmentBody = createSegmentBody(
      baseBody,
      chunks[index],
      index,
      lastIndex,
      parentMessageId
    );
    const started = await startCompletionRequest({ account: activeAccount, body: segmentBody });
    activeAccount = started.refreshedAccount ?? activeAccount;
    const ready = await readReadyFrame(started.response);

    try {
      activeAccount = await stopDeepseekCompletion({
        account: activeAccount,
        messageId: ready.responseMessageId,
        sessionId: baseBody.chat_session_id
      });
      await drainStoppedStream(ready.reader);
    } finally {
      await ready.reader.cancel().catch(() => {});
    }

    parentMessageId = ready.responseMessageId;
  }

  const finalBody = createSegmentBody(
    baseBody,
    chunks[lastIndex],
    lastIndex,
    lastIndex,
    parentMessageId
  );
  const final = await startCompletionRequest({ account: activeAccount, body: finalBody });
  return {
    ...final,
    chunkCount: chunks.length,
    interruptedCount: lastIndex,
    requestBody: finalBody
  };
}
