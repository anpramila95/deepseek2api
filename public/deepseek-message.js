import { escapeHtml } from "/utils.js";

const SECTION_KIND_BY_TYPE = Object.freeze({
  ANSWER: "response",
  THINKING: "thinking",
  THINK: "thinking",
  RESPONSE: "response"
});

function resolveSectionKind(type) {
  return type ? (SECTION_KIND_BY_TYPE[String(type).toUpperCase()] ?? "response") : null;
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

function appendDecodedDelta(deltas, state, kind, text, snapshot = false) {
  if (typeof text !== "string" || !text) {
    return;
  }

  state.currentKind = kind ?? state.currentKind;
  deltas.push({
    kind: state.currentKind,
    text,
    ...(snapshot ? { snapshot: true } : {})
  });
}

function appendFragmentDeltas(fragments, state, deltas, options = {}) {
  if (!Array.isArray(fragments)) {
    return;
  }

  if (options.snapshot) {
    const grouped = new Map();
    fragments.forEach((fragment) => {
      state.currentKind = resolveSectionKind(fragment?.type) ?? state.currentKind;
      if (typeof fragment?.content === "string" && fragment.content) {
        grouped.set(
          state.currentKind,
          (grouped.get(state.currentKind) ?? "") + fragment.content
        );
      }
    });
    grouped.forEach((text, kind) => appendDecodedDelta(deltas, state, kind, text, true));
    return;
  }

  fragments.forEach((fragment) => {
    state.currentKind = resolveSectionKind(fragment?.type) ?? state.currentKind;
    appendDecodedDelta(deltas, state, state.currentKind, fragment?.content);
  });
}

function appendResponseSnapshot(response, state, deltas) {
  if (Array.isArray(response.fragments)) {
    appendFragmentDeltas(response.fragments, state, deltas, { snapshot: true });
    return;
  }

  appendDecodedDelta(deltas, state, "thinking", response.thinking_content, true);
  appendDecodedDelta(deltas, state, "response", response.content, true);
}

function isSnapshotOperation(operation) {
  const type = String(operation || "").toUpperCase();
  return type === "SET" || type === "REPLACE";
}

function decodePatch(payload, state, deltas, basePath = "") {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const path = normalizePatchPath(basePath, payload.p ?? "");
  const value = payload.v;
  const response = value?.response ?? (!path ? payload.response : null);
  if (response && typeof response === "object") {
    appendResponseSnapshot(response, state, deltas);
    return;
  }

  if (payload.o === "BATCH" && Array.isArray(value)) {
    value.forEach((operation) => decodePatch(operation, state, deltas, path));
    return;
  }

  if (path === "response" && Array.isArray(value)) {
    value.forEach((operation) => decodePatch(operation, state, deltas, "response"));
    return;
  }

  if (path === "response/fragments" && Array.isArray(value)) {
    appendFragmentDeltas(value, state, deltas, { snapshot: payload.o !== "APPEND" });
    return;
  }

  if (/^response\/fragments\/-?\d+$/.test(path) && value && typeof value === "object") {
    appendFragmentDeltas([value], state, deltas, {
      snapshot: isSnapshotOperation(payload.o)
    });
    return;
  }

  if (/^response\/fragments\/-?\d+\/type$/.test(path)) {
    state.currentKind = resolveSectionKind(value) ?? state.currentKind;
    return;
  }

  if (path === "response/thinking_content" && typeof value === "string") {
    appendDecodedDelta(deltas, state, "thinking", value, isSnapshotOperation(payload.o));
    return;
  }

  if (path === "response/content" && typeof value === "string") {
    appendDecodedDelta(deltas, state, "response", value, isSnapshotOperation(payload.o));
    return;
  }

  if (/^response\/fragments\/-?\d+\/content$/.test(path) && typeof value === "string") {
    appendDecodedDelta(deltas, state, state.currentKind, value, isSnapshotOperation(payload.o));
    return;
  }

  if (!("p" in payload) && typeof value === "string") {
    appendDecodedDelta(deltas, state, state.currentKind, value);
  }
}

function toSection(kind, content) {
  return { kind, content };
}

function parseMarkdown(text) {
  if (typeof window !== "undefined" && window.marked && typeof window.marked.parse === "function") {
    try {
      return window.marked.parse(text ?? "");
    } catch {
      return escapeHtml(text ?? "");
    }
  }
  return escapeHtml(text ?? "");
}

function renderSectionMarkup(section) {
  const kind = escapeHtml(section.kind);
  const formattedContent = parseMarkdown(section.content);
  if (section.kind === "thinking") {
    return `<details class="message-section thinking" data-message-section="true" data-section-kind="thinking"><summary class="message-label">THINKING</summary><div class="markdown-body" data-section-text>${formattedContent}</div></details>`;
  }

  return `<div class="message-section ${kind}" data-message-section="true" data-section-kind="${kind}"><div class="markdown-body" data-section-text>${formattedContent}</div></div>`;
}

export function mapServerFile(file) {
  return {
    id: file.id,
    status: file.status,
    fileName: file.file_name,
    previewable: Boolean(file.previewable),
    fileSize: file.file_size,
    tokenUsage: file.token_usage,
    errorCode: file.error_code,
    insertedAt: file.inserted_at,
    updatedAt: file.updated_at
  };
}

function normalizeSections(sections, content) {
  if (Array.isArray(sections) && sections.length) {
    return sections;
  }

  if (!content) {
    return [];
  }

  return [toSection("response", content)];
}

function takeUnseenSuffix(previous, next) {
  if (!next || !previous) {
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

export function createSseParser(onEvent, options = {}) {
  const emitEmptyEvents = options.emitEmptyEvents === true;
  let buffer = "";
  let eventName = "message";
  let eventTouched = false;
  let dataLines = [];

  function emit() {
    if (!dataLines.length) {
      if (emitEmptyEvents && eventTouched) {
        onEvent({ event: eventName, data: "" });
      }
      eventName = "message";
      eventTouched = false;
      return;
    }

    onEvent({ event: eventName, data: dataLines.join("\n") });
    eventName = "message";
    eventTouched = false;
    dataLines = [];
  }

  function processLine(rawLine) {
    const line = rawLine.replace(/\r$/, "");

    if (!line) {
      emit();
      return;
    }

    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      eventTouched = true;
      return;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  return {
    push(chunk) {
      buffer += chunk;

      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n");
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        processLine(line);
      }
    },
    flush() {
      if (buffer) {
        processLine(buffer);
        buffer = "";
      }

      emit();
    }
  };
}

export function createDeepseekDeltaDecoder() {
  const state = { currentKind: "response" };

  function consumeAll(payloadText) {
    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      return [];
    }

    const deltas = [];
    decodePatch(payload, state, deltas);
    return deltas;
  }

  return {
    consumeAll,
    consume(payloadText) {
      const deltas = consumeAll(payloadText);
      if (!deltas.length) {
        return null;
      }

      const lastKind = deltas.at(-1).kind;
      const compatible = deltas.every((delta) => delta.kind === lastKind);
      const selected = compatible ? deltas : [deltas.at(-1)];
      return {
        kind: lastKind,
        text: selected.map((delta) => delta.text).join(""),
        ...(selected.every((delta) => delta.snapshot) ? { snapshot: true } : {})
      };
    }
  };
}

export function mapHistoryMessage(message) {
  let sections = (message.fragments || [])
    .filter((fragment) => fragment.content)
    .map((fragment) => toSection(resolveSectionKind(fragment.type) ?? "response", fragment.content));

  if (!sections.length && Array.isArray(message.sections)) {
    sections = message.sections
      .filter((section) => section?.content)
      .map((section) => toSection(
        section.kind === "thinking" ? "thinking" : "response",
        section.content
      ));
  }

  if (!sections.length) {
    if (message.thinking_content) {
      sections.push(toSection("thinking", message.thinking_content));
    }
    if (message.content) {
      sections.push(toSection("response", message.content));
    }
  }

  return {
    id: message.message_id,
    parentId: message.parent_id,
    role: message.role,
    files: (message.files || []).map(mapServerFile),
    sections
  };
}

export function appendDelta(message, delta) {
  const sections = normalizeSections(message.sections, message.content);
  if (!delta?.text) {
    return { ...message, sections };
  }

  const previous = sections
    .filter((section) => section.kind === delta.kind)
    .map((section) => section.content)
    .join("");
  const text = delta.snapshot ? takeUnseenSuffix(previous, delta.text) : delta.text;
  if (!text) {
    return { ...message, sections };
  }

  const lastSection = sections.at(-1);
  if (lastSection?.kind === delta.kind) {
    const nextSection = toSection(lastSection.kind, lastSection.content + text);
    return {
      ...message,
      sections: [...sections.slice(0, -1), nextSection]
    };
  }

  return {
    ...message,
    sections: [...sections, toSection(delta.kind, text)]
  };
}

export function renderMessageContent(message) {
  const sections = normalizeSections(message.sections, message.content);
  return sections.map(renderSectionMarkup).join("");
}
