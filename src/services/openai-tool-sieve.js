import { parseToolCallsFromText } from "./openai-tool-parser.js";

const TOOL_CAPTURE_TAG = "tool";

function findToolOpen(text, offset = 0) {
  const marker = `<${TOOL_CAPTURE_TAG}`;
  let index = text.indexOf(marker, offset);

  while (index >= 0) {
    const boundary = text[index + marker.length];
    if (boundary === undefined || /[\s/>]/.test(boundary)) {
      return index;
    }

    index = text.indexOf(marker, index + marker.length);
  }

  return -1;
}

function isInsideJsonString(text) {
  let escaped = false;
  let insideString = false;

  for (const character of text) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\" && insideString) {
      escaped = true;
      continue;
    }

    if (character === "\"") {
      insideString = !insideString;
    }
  }

  return insideString;
}

function findToolClose(captured, lower, openIndex) {
  const close = `</${TOOL_CAPTURE_TAG}>`;
  let closeIndex = lower.indexOf(close, openIndex);

  const bodyStart = lower.indexOf(">", openIndex);
  if (bodyStart < 0) {
    return { close, closeIndex: -1 };
  }

  while (closeIndex >= 0) {
    if (!isInsideJsonString(captured.slice(bodyStart + 1, closeIndex))) {
      return { close, closeIndex };
    }

    closeIndex = lower.indexOf(close, closeIndex + close.length);
  }

  return { close, closeIndex: -1 };
}

function isInsideCodeFence(state, prefix) {
  const combined = `${state.emittedText}${prefix}`;
  return (combined.match(/```/g)?.length ?? 0) % 2 === 1;
}

function findPartialToolTagStart(text) {
  const lastIndex = text.lastIndexOf("<");
  if (lastIndex < 0 || text.slice(lastIndex).includes(">")) {
    return -1;
  }

  const tail = text.slice(lastIndex).toLowerCase();
  return `<${TOOL_CAPTURE_TAG}`.startsWith(tail) ? lastIndex : -1;
}

function findToolSegmentStart(state, text) {
  const lower = text.toLowerCase();
  let offset = 0;

  while (offset < lower.length) {
    const bestIndex = findToolOpen(lower, offset);

    if (bestIndex === -1) {
      return -1;
    }

    if (!isInsideCodeFence(state, text.slice(0, bestIndex))) {
      return bestIndex;
    }

    offset = bestIndex + TOOL_CAPTURE_TAG.length + 1;
  }

  return -1;
}

function splitSafeContent(state, text) {
  const partialStart = findPartialToolTagStart(text);
  if (partialStart < 0 || isInsideCodeFence(state, text.slice(0, partialStart))) {
    return { safe: text, hold: "" };
  }

  return { safe: text.slice(0, partialStart), hold: text.slice(partialStart) };
}

function consumeCapturedToolBlock(captured, allowedToolNames) {
  const lower = captured.toLowerCase();
  const openIndex = findToolOpen(lower);
  if (openIndex < 0) {
    return { ready: true, prefix: captured, calls: [], suffix: "" };
  }

  const { close, closeIndex } = findToolClose(captured, lower, openIndex);
  if (closeIndex < openIndex) {
    return { ready: false };
  }

  const closeEnd = closeIndex + close.length;
  return {
    ready: true,
    prefix: captured.slice(0, openIndex),
    calls: parseToolCallsFromText(captured.slice(openIndex, closeEnd), allowedToolNames),
    suffix: captured.slice(closeEnd)
  };
}

function pushTextEvent(state, events, text) {
  if (!text) {
    return;
  }

  const combined = `${state.heldWhitespace}${text}`;
  const trailingWhitespace = combined.match(/\s+$/)?.[0] ?? "";
  const safeText = trailingWhitespace
    ? combined.slice(0, -trailingWhitespace.length)
    : combined;

  state.heldWhitespace = trailingWhitespace;
  if (!safeText) {
    return;
  }

  state.emittedText += safeText;
  events.push({ type: "text", text: safeText });
}

function pushToolCallsEvent(state, events, calls) {
  if (!calls?.length) {
    return;
  }

  state.heldWhitespace = "";
  state.sawToolCall = true;
  events.push({ type: "tool_calls", calls });
}

export function createToolSieve(allowedToolNames = []) {
  const state = {
    allowedToolNames,
    capture: "",
    capturing: false,
    emittedText: "",
    heldWhitespace: "",
    pending: "",
    sawToolCall: false
  };

  function drain() {
    const events = [];

    while (true) {
      if (state.capturing) {
        if (state.pending) {
          state.capture += state.pending;
          state.pending = "";
        }

        const consumed = consumeCapturedToolBlock(state.capture, state.allowedToolNames);
        if (!consumed.ready) {
          break;
        }

        state.capture = "";
        state.capturing = false;
        pushTextEvent(state, events, consumed.prefix ?? "");
        pushToolCallsEvent(state, events, consumed.calls);
        state.pending = `${consumed.suffix ?? ""}${state.pending}`;
        continue;
      }

      if (!state.pending) {
        break;
      }

      const start = findToolSegmentStart(state, state.pending);
      if (start >= 0) {
        pushTextEvent(state, events, state.pending.slice(0, start));
        state.capture = state.pending.slice(start);
        state.pending = "";
        state.capturing = true;
        continue;
      }

      const { safe, hold } = splitSafeContent(state, state.pending);
      state.pending = hold;
      pushTextEvent(state, events, safe);
      break;
    }

    return events;
  }

  return Object.freeze({
    flush() {
      const events = drain();

      if (state.capturing) {
        const consumed = consumeCapturedToolBlock(state.capture, state.allowedToolNames);
        if (consumed.ready) {
          pushTextEvent(state, events, consumed.prefix ?? "");
          pushToolCallsEvent(state, events, consumed.calls);
          pushTextEvent(state, events, consumed.suffix ?? "");
        } else {
          pushTextEvent(state, events, state.capture);
        }
      }

      pushTextEvent(state, events, state.pending);
      if (state.heldWhitespace && (!state.sawToolCall || state.emittedText.trim())) {
        state.emittedText += state.heldWhitespace;
        events.push({ type: "text", text: state.heldWhitespace });
      }
      state.capture = "";
      state.capturing = false;
      state.heldWhitespace = "";
      state.pending = "";
      return events;
    },
    push(chunk) {
      state.pending += typeof chunk === "string" ? chunk : String(chunk ?? "");
      return drain();
    }
  });
}

function toTextEvent(chunk) {
  return { type: "text", text: typeof chunk === "string" ? chunk : String(chunk ?? "") };
}

function flattenToolEvents(events) {
  return events.reduce((output, event) => {
    if (!output.length || event.type !== "text" || output.at(-1).type !== "text") {
      output.push(event);
      return output;
    }

    output[output.length - 1] = {
      type: "text",
      text: `${output.at(-1).text}${event.text}`
    };
    return output;
  }, []);
}

export function splitToolAwareEvents(text, allowedToolNames = []) {
  if (!allowedToolNames?.length) {
    return [toTextEvent(text)];
  }

  const sieve = createToolSieve(allowedToolNames);
  const events = [...sieve.push(text), ...sieve.flush()];
  return flattenToolEvents(events);
}

export function extractToolAwareOutput(text, allowedToolNames = []) {
  const events = splitToolAwareEvents(text, allowedToolNames);
  return {
    events,
    content: events
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join(""),
    toolCalls: events.flatMap((event) => event.type === "tool_calls" ? event.calls ?? [] : [])
  };
}
