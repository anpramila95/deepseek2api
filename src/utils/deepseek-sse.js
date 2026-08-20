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

    onEvent({
      event: eventName,
      data: dataLines.join("\n")
    });

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

const FRAGMENT_KIND_BY_TYPE = Object.freeze({
  ANSWER: "response",
  THINKING: "thinking",
  THINK: "thinking",
  RESPONSE: "response"
});

function resolveFragmentKind(type) {
  return FRAGMENT_KIND_BY_TYPE[String(type || "").toUpperCase()] ?? null;
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

function appendDelta(deltas, state, kind, text, snapshot = false) {
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
      state.currentKind = resolveFragmentKind(fragment?.type) ?? state.currentKind;
      if (typeof fragment?.content === "string" && fragment.content) {
        grouped.set(
          state.currentKind,
          (grouped.get(state.currentKind) ?? "") + fragment.content
        );
      }
    });
    grouped.forEach((text, kind) => appendDelta(deltas, state, kind, text, true));
    return;
  }

  fragments.forEach((fragment) => {
    state.currentKind = resolveFragmentKind(fragment?.type) ?? state.currentKind;
    appendDelta(deltas, state, state.currentKind, fragment?.content);
  });
}

function appendResponseSnapshot(response, state, deltas) {
  if (Array.isArray(response.fragments)) {
    appendFragmentDeltas(response.fragments, state, deltas, { snapshot: true });
    return;
  }

  appendDelta(deltas, state, "thinking", response.thinking_content, true);
  appendDelta(deltas, state, "response", response.content, true);
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
    appendFragmentDeltas(value, state, deltas, {
      snapshot: payload.o !== "APPEND"
    });
    return;
  }

  if (/^response\/fragments\/-?\d+$/.test(path) && value && typeof value === "object") {
    appendFragmentDeltas([value], state, deltas, {
      snapshot: isSnapshotOperation(payload.o)
    });
    return;
  }

  if (/^response\/fragments\/-?\d+\/type$/.test(path)) {
    state.currentKind = resolveFragmentKind(value) ?? state.currentKind;
    return;
  }

  if (path === "response/thinking_content" && typeof value === "string") {
    appendDelta(deltas, state, "thinking", value, isSnapshotOperation(payload.o));
    return;
  }

  if (path === "response/content" && typeof value === "string") {
    appendDelta(deltas, state, "response", value, isSnapshotOperation(payload.o));
    return;
  }

  if (/^response\/fragments\/-?\d+\/content$/.test(path) && typeof value === "string") {
    appendDelta(deltas, state, state.currentKind, value, isSnapshotOperation(payload.o));
    return;
  }

  if (!("p" in payload) && typeof value === "string") {
    appendDelta(deltas, state, state.currentKind, value);
  }
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

export function extractContentDelta(payloadText) {
  return createDeepseekDeltaDecoder()
    .consumeAll(payloadText)
    .map((delta) => delta.text)
    .join("");
}
