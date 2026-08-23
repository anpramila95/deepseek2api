import { config } from "../config.js";
import { createDeepseekDeltaDecoder, createSseParser } from "../utils/deepseek-sse.js";
import { proxyDeepseekRequest } from "./deepseek-proxy.js";

const STREAM_CONTENT_TYPE = "text/event-stream";
const RESUME_PATH = "/chat/resume_stream";
const CONTINUE_PATH = "/chat/continue";
const FULL_MESSAGE_BIZ_CODE = 22;

const MESSAGE_STATUS = Object.freeze({
  CONTENT_FILTER: "CONTENT_FILTER",
  CONTEXT_LENGTH_EXCEEDED: "CONTEXT_LENGTH_EXCEEDED",
  FINISHED: "FINISHED",
  INCOMPLETE: "INCOMPLETE",
  TIMEOUT: "TIMEOUT",
  WIP: "WIP"
});
const COMPLETE_MESSAGE_STATUSES = new Set([
  MESSAGE_STATUS.FINISHED,
  MESSAGE_STATUS.CONTENT_FILTER
]);
const INCOMPLETE_TERMINAL_STATUSES = new Set([
  MESSAGE_STATUS.CONTEXT_LENGTH_EXCEEDED,
  MESSAGE_STATUS.TIMEOUT
]);

const DEFAULT_MAX_RESUMES = config.deepseekCompletion?.maxResumes ?? 12;
const DEFAULT_MAX_CONTINUES = config.deepseekCompletion?.maxContinues ?? 12;
const DEFAULT_RESUME_DELAY_MS = config.deepseekCompletion?.resumeDelayMs ?? 250;
const DEFAULT_CONTINUE_DELAY_MS = config.deepseekCompletion?.continueDelayMs ?? 250;

function createStatusError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createStreamTransportError(error) {
  const message = error?.message || "DeepSeek stream transport interrupted";
  const wrapped = createStatusError(502, `DeepSeek stream transport interrupted: ${message}`);
  wrapped.cause = error;
  return wrapped;
}

function resolveErrorMessage(payload, fallback) {
  return payload?.data?.biz_msg || payload?.msg || payload?.error || fallback;
}

async function parseJsonPayload(response) {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function getBizCode(payload) {
  const value = payload?.data?.biz_code ?? payload?.code;
  return typeof value === "number" ? value : Number(value);
}

function normalizeMessageId(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return typeof value === "number" || typeof value === "string"
    ? value
    : String(value);
}

function resolveResponseMessageId(payload) {
  return normalizeMessageId(
    payload?.response_message_id
      ?? payload?.message_id
      ?? payload?.data?.response_message_id
      ?? payload?.data?.biz_data?.response_message_id
      ?? payload?.data?.biz_data?.ready?.response_message_id
      ?? payload?.data?.biz_data?.message?.message_id
  );
}

function hasMessageContent(message) {
  return Array.isArray(message?.fragments)
    || Array.isArray(message?.sections)
    || typeof message?.thinking_content === "string"
    || typeof message?.content === "string";
}

function resolveFullMessage(payload) {
  const bizData = payload?.data?.biz_data;
  const candidates = [
    bizData?.message,
    bizData?.response?.message,
    bizData?.response,
    bizData?.chat_message,
    bizData
  ];

  return candidates.find(hasMessageContent) ?? null;
}

function resolveFragmentKind(type) {
  const normalized = String(type || "").toUpperCase();
  return normalized === "THINK" || normalized === "THINKING"
    ? "thinking"
    : "response";
}

function getMessageSections(message) {
  if (Array.isArray(message?.fragments)) {
    return message.fragments
      .filter((fragment) => typeof fragment?.content === "string")
      .map((fragment) => ({
        kind: resolveFragmentKind(fragment.type),
        content: fragment.content
      }));
  }

  if (Array.isArray(message?.sections)) {
    return message.sections
      .filter((section) => typeof section?.content === "string")
      .map((section) => ({
        kind: section.kind === "thinking" ? "thinking" : "response",
        content: section.content
      }));
  }

  const sections = [];
  if (typeof message?.thinking_content === "string") {
    sections.push({ kind: "thinking", content: message.thinking_content });
  }
  if (typeof message?.content === "string") {
    sections.push({ kind: "response", content: message.content });
  }
  return sections;
}

function takeUnseenSuffix(previous, next) {
  if (!next) {
    return "";
  }

  if (!previous) {
    return next;
  }

  if (next.startsWith(previous)) {
    return next.slice(previous.length);
  }

  if (previous.endsWith(next)) {
    return "";
  }

  const maximumOverlap = Math.min(previous.length, next.length);
  for (let length = maximumOverlap; length > 0; length -= 1) {
    if (previous.endsWith(next.slice(0, length))) {
      return next.slice(length);
    }
  }

  return next;
}

const V3_BRANDING_PATTERN = /DeepSeek[\s_*~-]*V3\b/gi;

function getCurrentDateReplacement() {
  const now = new Date();
  return {
    vi: `tháng ${now.getMonth() + 1} năm ${now.getFullYear()}`,
    en: now.toLocaleString("en-US", { month: "long", year: "numeric" }),
    zh: `${now.getFullYear()}年${now.getMonth() + 1}月`,
    iso: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  };
}

export function sanitizeBrandingText(text) {
  if (typeof text !== "string" || !text) {
    return text;
  }

  const currentDate = getCurrentDateReplacement();

  return text
    .replace(V3_BRANDING_PATTERN, "DeepSeek-V4")
    .replace(/tháng\s*5\s*năm\s*2025/gi, currentDate.vi)
    .replace(/\bMay\s*2025\b/gi, currentDate.en)
    .replace(/2025\s*年\s*5\s*月/g, currentDate.zh)
    .replace(/2025-05\b/g, currentDate.iso);
}

function createDeltaAccumulator(onDelta) {
  const totals = {
    thinking: "",
    response: ""
  };

  function emit(kind, text, { snapshot = false } = {}) {
    const normalizedKind = kind === "thinking" ? "thinking" : "response";
    const unseen = snapshot ? takeUnseenSuffix(totals[normalizedKind], text) : text;
    if (!unseen) {
      return;
    }

    const sanitized = sanitizeBrandingText(unseen);
    totals[normalizedKind] += sanitized;
    onDelta?.({ kind: normalizedKind, text: sanitized });
  }

  function emitDecoded(delta) {
    if (delta?.text) {
      emit(delta.kind, delta.text, { snapshot: delta.snapshot === true });
    }
  }

  function emitMessage(message) {
    const grouped = new Map();
    getMessageSections(message).forEach((section) => {
      grouped.set(section.kind, (grouped.get(section.kind) ?? "") + section.content);
    });
    grouped.forEach((text, kind) => emit(kind, text, { snapshot: true }));
  }

  return {
    emitDecoded,
    emitMessage,
    totals
  };
}

function normalizeMessageStatus(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return Object.values(MESSAGE_STATUS).includes(normalized) ? normalized : null;
}

function createMessageState() {
  return {
    accumulatedTokenUsage: null,
    incompleteMessage: null,
    quasiStatus: null,
    status: null
  };
}

function getEffectiveMessageStatus(messageState) {
  if (messageState.status && messageState.status !== MESSAGE_STATUS.WIP) {
    return messageState.status;
  }

  return messageState.quasiStatus ?? messageState.status;
}

function updateMessageStateFromMessage(message, messageState, responseMessageIdRef) {
  if (!message || typeof message !== "object") {
    return;
  }

  const messageId = resolveResponseMessageId(message);
  if (messageId !== null) {
    responseMessageIdRef.value = messageId;
  }

  if (Object.hasOwn(message, "status")) {
    messageState.status = normalizeMessageStatus(message.status);
  }

  if (Object.hasOwn(message, "quasi_status")) {
    messageState.quasiStatus = normalizeMessageStatus(message.quasi_status);
  } else if (Object.hasOwn(message, "quasiStatus")) {
    messageState.quasiStatus = normalizeMessageStatus(message.quasiStatus);
  }

  if (Object.hasOwn(message, "incomplete_message")) {
    messageState.incompleteMessage = message.incomplete_message ?? null;
  } else if (Object.hasOwn(message, "incompleteMessage")) {
    messageState.incompleteMessage = message.incompleteMessage ?? null;
  }
}

function normalizePatchPath(basePath, path) {
  const normalizedBase = String(basePath || "").replace(/^\/+|\/+$/g, "");
  const normalizedPath = String(path || "").replace(/^\/+|\/+$/g, "");
  if (!normalizedPath) {
    return normalizedBase;
  }

  if (normalizedPath === "response" || normalizedPath.startsWith("response/")) {
    return normalizedPath;
  }

  return normalizedBase ? `${normalizedBase}/${normalizedPath}` : normalizedPath;
}

function inspectMessagePatch(payload, messageState, responseMessageIdRef, basePath = "") {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const path = normalizePatchPath(basePath, payload.p ?? "");
  const value = payload.v;
  const response = value?.response
    ?? (!path ? payload.response : null)
    ?? (path === "response" && value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null);

  if (response && typeof response === "object") {
    updateMessageStateFromMessage(response, messageState, responseMessageIdRef);
  }

  if (String(payload.o || "").toUpperCase() === "BATCH" && Array.isArray(value)) {
    value.forEach((operation) => {
      inspectMessagePatch(operation, messageState, responseMessageIdRef, path);
    });
    return;
  }

  if (path === "response" && Array.isArray(value)) {
    value.forEach((operation) => {
      inspectMessagePatch(operation, messageState, responseMessageIdRef, "response");
    });
    return;
  }

  if (path === "response/status") {
    messageState.status = normalizeMessageStatus(value);
    return;
  }

  if (path === "response/quasi_status" || path === "response/quasiStatus") {
    messageState.quasiStatus = normalizeMessageStatus(value);
    return;
  }

  if (path === "response/accumulated_token_usage" || path === "response/accumulatedTokenUsage") {
    const tokens = Number(value);
    if (Number.isFinite(tokens) && tokens >= 0) {
      messageState.accumulatedTokenUsage = Math.trunc(tokens);
    }
    return;
  }

  if (path === "response/incomplete_message" || path === "response/incompleteMessage") {
    messageState.incompleteMessage = value ?? null;
    return;
  }

  if (path === "response/message_id" || path === "response/messageId") {
    const messageId = normalizeMessageId(value);
    if (messageId !== null) {
      responseMessageIdRef.value = messageId;
    }
  }
}

function resetMessageStateForContinuation(messageState) {
  messageState.status = MESSAGE_STATUS.WIP;
  messageState.quasiStatus = null;
  messageState.incompleteMessage = null;
}

function createProtocolSignal(event, payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const type = String(payload.type ?? "").toLowerCase();
  const finishReason = String(payload.finish_reason ?? "").trim().toLowerCase();
  const isKnownFailureReason = /rate.?limit|quota|too many|frequency|频繁|限流|busy|overload|繁忙/.test(
    finishReason
  );
  if (
    (!["hint", "toast"].includes(event) && event !== "finish")
    || (type !== "error" && !isKnownFailureReason)
  ) {
    return null;
  }

  return {
    clearResponse: payload.clear_response === true,
    content: typeof payload.content === "string" ? payload.content : "",
    event,
    finishReason
  };
}

function createProtocolSignalError(signal) {
  const marker = `${signal.finishReason} ${signal.content}`.toLowerCase();
  const statusCode = /rate.?limit|quota|too many|frequency|频繁|限流/.test(marker)
    ? 429
    : /busy|overload|繁忙/.test(marker)
      ? 503
      : 502;
  return createStatusError(
    statusCode,
    signal.content || signal.finishReason || "DeepSeek stopped the completion"
  );
}

async function wait(milliseconds) {
  if (!milliseconds) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function classifyNonStreamResponse(response) {
  const payload = await parseJsonPayload(response);
  const bizCode = getBizCode(payload);

  if (
    !response.ok
    || !payload
    || payload?.error
    || (Number.isFinite(bizCode) && bizCode !== 0 && bizCode !== FULL_MESSAGE_BIZ_CODE)
  ) {
    throw createStatusError(
      response.ok ? 502 : response.status,
      resolveErrorMessage(payload, `HTTP ${response.status}`)
    );
  }

  const fullMessage = resolveFullMessage(payload);
  if (!fullMessage) {
    throw createStatusError(502, "DeepSeek returned a non-stream response without a completed message");
  }

  return { fullMessage, payload };
}

async function consumeStreamAttempt({
  response,
  decoder,
  accumulator,
  messageState,
  onProtocolEvent,
  onReady,
  responseMessageIdRef
}) {
  if (!response.ok) {
    const payload = await classifyNonStreamResponse(response);
    return {
      closed: true,
      fullMessage: payload.fullMessage,
      nonStream: true
    };
  }

  if (!response.body) {
    throw createStatusError(502, "DeepSeek returned an empty stream body");
  }

  const textDecoder = new TextDecoder();
  let closed = false;
  let receivedEvent = false;
  let streamError = null;
  let protocolSignal = null;
  let sawFinish = false;
  let closeBehavior = "";
  const parser = createSseParser(({ data, event }) => {
    receivedEvent = true;

    if (!data || data === "[DONE]") {
      if (data === "[DONE]" || event === "close") {
        closed = true;
      }
      if (event === "finish") {
        sawFinish = true;
      }
      onProtocolEvent?.({ data, event, payload: null });
      return;
    }

    let payload = null;
    try {
      payload = JSON.parse(data);
    } catch {
      // Unknown message frames remain forward-compatible and are ignored.
    }

    const payloadId = resolveResponseMessageId(payload);
    if (payloadId !== null) {
      responseMessageIdRef.value = payloadId;
    }
    inspectMessagePatch(payload, messageState, responseMessageIdRef);

    if (event === "ready") {
      onReady?.(payload);
      onProtocolEvent?.({ data, event, payload });
      return;
    }

    if (event === "close") {
      closed = true;
      closeBehavior = String(
        payload?.click_behavior ?? payload?.clickBehavior ?? ""
      ).trim().toLowerCase();
    }
    if (event === "finish") {
      sawFinish = true;
    }

    protocolSignal = createProtocolSignal(event, payload) ?? protocolSignal;
    onProtocolEvent?.({ data, event, payload });

    if (event !== "message" && event !== "delta") {
      return;
    }

    decoder.consumeAll(data).forEach((delta) => accumulator.emitDecoded(delta));
  }, { emitEmptyEvents: true });

  try {
    for await (const chunk of response.body) {
      parser.push(textDecoder.decode(chunk, { stream: true }));
    }
  } catch (error) {
    streamError = error;
  } finally {
    parser.push(textDecoder.decode());
    parser.flush();
  }

  return {
    closed,
    closeBehavior,
    empty: !receivedEvent,
    protocolSignal,
    sawFinish,
    streamError
  };
}

async function resumeCompletion({ account, sessionId, messageId }) {
  return proxyDeepseekRequest({
    account,
    method: "POST",
    path: RESUME_PATH,
    body: Buffer.from(JSON.stringify({
      chat_session_id: sessionId,
      message_id: messageId
    })),
    headers: { "content-type": "application/json" }
  });
}

async function continueCompletion({ account, sessionId, messageId }) {
  return proxyDeepseekRequest({
    account,
    method: "POST",
    path: CONTINUE_PATH,
    body: Buffer.from(JSON.stringify({
      chat_session_id: sessionId,
      message_id: messageId,
      fallback_to_resume: true
    })),
    headers: { "content-type": "application/json" }
  });
}

function createCompletionResult({
  accumulator,
  activeAccount,
  completed,
  continueCount,
  messageState,
  responseMessageIdRef,
  resumeCount
}) {
  return {
    accumulatedTokenUsage: messageState.accumulatedTokenUsage,
    completed,
    content: accumulator.totals.response,
    reasoningContent: accumulator.totals.thinking,
    responseMessageId: responseMessageIdRef.value,
    status: getEffectiveMessageStatus(messageState),
    continueCount,
    resumeCount,
    refreshedAccount: activeAccount
  };
}

function shouldContinueAttempt(attempt, messageState) {
  const effectiveStatus = getEffectiveMessageStatus(messageState);
  if (effectiveStatus === MESSAGE_STATUS.INCOMPLETE) {
    return true;
  }

  return (!effectiveStatus || effectiveStatus === MESSAGE_STATUS.WIP)
    && attempt.closeBehavior === "continue";
}

function isConfirmedComplete(attempt, effectiveStatus) {
  if (COMPLETE_MESSAGE_STATUSES.has(effectiveStatus)) {
    return true;
  }

  if (INCOMPLETE_TERMINAL_STATUSES.has(effectiveStatus)) {
    return false;
  }

  if (effectiveStatus === MESSAGE_STATUS.WIP) {
    return attempt.sawFinish === true;
  }

  // A full non-stream message (including resume biz code 22) is itself a
  // snapshot confirmation.  For SSE, an otherwise status-less `close` is
  // ambiguous and must be followed by resume rather than deleting a possibly
  // incomplete incognito session.
  return effectiveStatus === null
    && (attempt.nonStream === true || attempt.sawFinish === true);
}

/**
 * Consume a DeepSeek completion through the HTTP/SSE protocol. A transport
 * that disappears before `close` is resumed with `/chat/resume_stream`; a
 * message whose terminal status is `INCOMPLETE` is extended with
 * `/chat/continue` until the server confirms a complete response.
 */
export async function consumeDeepseekCompletion({
  account,
  continueDelayMs = DEFAULT_CONTINUE_DELAY_MS,
  maxContinues = DEFAULT_MAX_CONTINUES,
  maxResumes = DEFAULT_MAX_RESUMES,
  onDelta,
  onProtocolEvent,
  onReady,
  response,
  resumeDelayMs = DEFAULT_RESUME_DELAY_MS,
  sessionId
}) {
  const decoder = createDeepseekDeltaDecoder();
  const accumulator = createDeltaAccumulator(onDelta);
  const messageState = createMessageState();
  const responseMessageIdRef = { value: null };
  let currentResponse = response;
  let activeAccount = account;
  let continueCount = 0;
  let resumeCount = 0;

  while (currentResponse) {
    const contentType = currentResponse.headers.get("content-type") ?? "";
    let attempt;

    if (!contentType.includes(STREAM_CONTENT_TYPE)) {
      const result = await classifyNonStreamResponse(currentResponse);
      accumulator.emitMessage(result.fullMessage);
      updateMessageStateFromMessage(result.fullMessage, messageState, responseMessageIdRef);
      attempt = { closed: true, nonStream: true, protocolSignal: null };
    } else {
      attempt = await consumeStreamAttempt({
        accumulator,
        decoder,
        messageState,
        onProtocolEvent,
        onReady,
        response: currentResponse,
        responseMessageIdRef
      });

      if (attempt.fullMessage) {
        accumulator.emitMessage(attempt.fullMessage);
        updateMessageStateFromMessage(attempt.fullMessage, messageState, responseMessageIdRef);
      }
    }

    if (attempt.protocolSignal) {
      throw createProtocolSignalError(attempt.protocolSignal);
    }

    if (attempt.empty) {
      if (attempt.streamError) {
        throw createStreamTransportError(attempt.streamError);
      }
      throw createStatusError(502, "DeepSeek stream ended without any SSE events");
    }

    const effectiveStatus = getEffectiveMessageStatus(messageState);
    if (attempt.closed && shouldContinueAttempt(attempt, messageState)) {
      if (continueCount >= maxContinues) {
        throw createStatusError(
          502,
          "DeepSeek response remained incomplete after the automatic continue limit"
        );
      }

      if (responseMessageIdRef.value === null) {
        throw createStatusError(502, "DeepSeek returned an incomplete message without a message id");
      }

      continueCount += 1;
      resetMessageStateForContinuation(messageState);
      await wait(continueDelayMs);
      const continued = await continueCompletion({
        account: activeAccount,
        messageId: responseMessageIdRef.value,
        sessionId
      });
      activeAccount = continued.refreshedAccount ?? activeAccount;
      currentResponse = continued.response;
      continue;
    }

    if (attempt.closed && isConfirmedComplete(attempt, effectiveStatus)) {
      return createCompletionResult({
        accumulator,
        activeAccount,
        completed: true,
        continueCount,
        messageState,
        responseMessageIdRef,
        resumeCount
      });
    }

    if (attempt.closed && INCOMPLETE_TERMINAL_STATUSES.has(effectiveStatus)) {
      return createCompletionResult({
        accumulator,
        activeAccount,
        completed: false,
        continueCount,
        messageState,
        responseMessageIdRef,
        resumeCount
      });
    }

    if (resumeCount >= maxResumes) {
      if (attempt.streamError) {
        throw createStreamTransportError(attempt.streamError);
      }
      throw createStatusError(
        502,
        "DeepSeek stream ended before completion and the automatic resume limit was reached"
      );
    }

    if (responseMessageIdRef.value === null) {
      if (attempt.streamError) {
        throw createStreamTransportError(attempt.streamError);
      }
      throw createStatusError(
        502,
        "DeepSeek stream ended before a response message id was received"
      );
    }

    resumeCount += 1;
    await wait(resumeDelayMs);
    const resumed = await resumeCompletion({
      account: activeAccount,
      messageId: responseMessageIdRef.value,
      sessionId
    });
    activeAccount = resumed.refreshedAccount ?? activeAccount;
    currentResponse = resumed.response;
  }

  throw createStatusError(502, "DeepSeek completion ended without a response");
}

export const DEEPSEEK_STREAM_DEFAULTS = Object.freeze({
  continueDelayMs: DEFAULT_CONTINUE_DELAY_MS,
  maxContinues: DEFAULT_MAX_CONTINUES,
  maxResumes: DEFAULT_MAX_RESUMES,
  resumeDelayMs: DEFAULT_RESUME_DELAY_MS
});

export const DEEPSEEK_MESSAGE_STATUS = MESSAGE_STATUS;
