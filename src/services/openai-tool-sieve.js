import { parseToolCallsFromText } from "./openai-tool-parser.js";

const TOOL_CAPTURE_TAG = "tool";

function findToolOpen(text, offset = 0) {
  // Only XML tool tags are stream delimiters. Raw JSON can be ordinary text
  // or file content and must not be promoted to a tool call without a name.
  const patterns = [
    /<(?:tool|tool_call|function_call|tool_result|execute_code)\b/i,
    /<\|\s*DSML\s*\|>\s*(?:tool\s+)?name\s*=/i
  ];

  let minIndex = -1;
  const searchSlice = text.slice(offset);
  for (const pattern of patterns) {
    const match = pattern.exec(searchSlice);
    if (match) {
      const actualIndex = offset + match.index;
      if (minIndex === -1 || actualIndex < minIndex) {
        minIndex = actualIndex;
      }
    }
  }

  return minIndex;
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
  // 1. Kiểm tra XML close tag
  const xmlMatch = /(?:<\/(?:tool|tool_call|function_call|execute_code)\s*>|<\|\s*DSML\s*\|>\s*(?:\|>)?)/i.exec(captured.slice(openIndex));
  if (xmlMatch) {
    return {
      close: xmlMatch[0],
      closeIndex: openIndex + xmlMatch.index
    };
  }

  // 2. Kiểm tra JSON object đóng hoàn chỉnh
  const slice = captured.slice(openIndex);
  if (slice.startsWith("{")) {
    let braceCount = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < slice.length; i++) {
      const char = slice[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === "{") braceCount++;
        else if (char === "}") {
          braceCount--;
          if (braceCount === 0) {
            return {
              close: "}",
              closeIndex: openIndex + i
            };
          }
        }
      }
    }
  }

  return { close: "", closeIndex: -1 };
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
  const resultOpen = lower.search(/<tool_result\b[^>]*>/i);
  if (resultOpen >= 0) {
    const resultClose = lower.indexOf("</tool_result>", resultOpen);
    if (resultClose < 0) {
      return { ready: false };
    }
    return {
      ready: true,
      prefix: "",
      calls: [],
      dropTranscript: true,
      suffix: captured.slice(resultClose + "</tool_result>".length)
    };
  }

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
        if (!consumed.dropTranscript && !consumed.calls?.length) {
          pushTextEvent(state, events, consumed.prefix ?? "");
        }
        pushToolCallsEvent(state, events, consumed.calls);
        // Drop echoed result, but preserve any following real tool tag.
        state.pending = consumed.dropTranscript ? (consumed.suffix ?? "") : "";
        continue;
      }

      if (!state.pending) {
        break;
      }

      const start = findToolSegmentStart(state, state.pending);
      if (start >= 0) {
        let prefix = state.pending.slice(0, start);
        const segment = state.pending.slice(start).toLowerCase();
        if (segment.startsWith("<tool_result") || segment.startsWith("<tool_result")) {
          prefix = prefix.replace(/(?:^|\s)tool\s*:\s*$/i, "");
        }
        pushTextEvent(state, events, prefix);
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
          if (!consumed.dropTranscript && !consumed.calls?.length) {
            pushTextEvent(state, events, consumed.prefix ?? "");
          }
          pushToolCallsEvent(state, events, consumed.calls);
          state.pending = consumed.dropTranscript ? (consumed.suffix ?? "") : "";
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
