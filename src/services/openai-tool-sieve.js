import { normalizeDsmlTokenVariants, parseToolCallsFromText } from "./openai-tool-parser.js";

const TOOL_CAPTURE_TAG = "tool";
const DSML_TRAILER_PATTERN = /\s*<[^>]*DSML[^>]*\b(?:parameter|invoke|calls?|tool_calls)\b[^>]*>\s*/gi;

function stripDsmlTrailer(text) {
  return String(text ?? "").replace(DSML_TRAILER_PATTERN, "");
}

function normalizeDsmlStream(text) {
  return normalizeDsmlTokenVariants(text);
}

function isDsmlMarker(text) {
  const norm = normalizeDsmlStream(text);
  return /<\|DSML\|/i.test(norm) || /<\/?\s*\|\s*\|\s*DSML/i.test(text) || /DSML/i.test(text);
}

function findToolOpen(text, offset = 0) {
  const patterns = [
    /<(?:tool|tool_call|function_call|tool_result|execute_code)\b/i,
    /<\s*(\/?)\s*[|｜]+\s*DSML/i,
    /<\|DSML\|/i,
    /<[^>]*DSML/i
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
  const slice = captured.slice(openIndex);

  // 1. Kiểm tra DSML closing tags (phải có dấu / đóng)
  const dsmlCallsClose = /<\s*[/|｜]+\s*DSML\s*[/|｜]+\s*calls?\s*>/i.exec(slice);
  if (dsmlCallsClose) {
    return {
      close: dsmlCallsClose[0],
      closeIndex: openIndex + dsmlCallsClose.index
    };
  }

  const dsmlInvokeClose = /<\s*[/|｜]+\s*DSML\s*[/|｜]+\s*invoke\s*>/i.exec(slice);
  if (dsmlInvokeClose) {
    return {
      close: dsmlInvokeClose[0],
      closeIndex: openIndex + dsmlInvokeClose.index
    };
  }

  // 2. Kiểm tra XML close tag chuẩn
  const xmlMatch = /(?:<\/(?:tool|tool_call|function_call|execute_code)\s*>|<\/\s*[|｜]+\s*DSML\s*[|｜]+\s*(?:parameter|invoke|calls?)\b[^>]*>|<\|\s*DSML\s*\|>\s*\|>)/i.exec(slice);
  if (xmlMatch) {
    return {
      close: xmlMatch[0],
      closeIndex: openIndex + xmlMatch.index
    };
  }

  // 3. Kiểm tra JSON object đóng hoàn chỉnh
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
  if (lastIndex < 0) {
    return -1;
  }

  const tail = text.slice(lastIndex);
  // If tag is already closed, check if it is part of a DSML sequence
  if (tail.includes(">")) {
    if (/<\s*(\/?)\s*[|｜]+\s*DSML/i.test(tail) || /<\|\|DSML/i.test(tail)) {
      return lastIndex;
    }
    return -1;
  }

  const lowerTail = tail.toLowerCase();
  if (`<${TOOL_CAPTURE_TAG}`.startsWith(lowerTail)) return lastIndex;
  if ("<||dsml||".startsWith(lowerTail)) return lastIndex;
  if ("< | | dsml".startsWith(lowerTail)) return lastIndex;
  if ("< |".startsWith(lowerTail)) return lastIndex;
  if ("< /".startsWith(lowerTail)) return lastIndex;
  if ("</".startsWith(lowerTail)) return lastIndex;
  return -1;
}

function findToolSegmentStart(state, text) {
  let offset = 0;

  while (offset < text.length) {
    const bestIndex = findToolOpen(text, offset);

    if (bestIndex === -1) {
      return -1;
    }

    if (!isInsideCodeFence(state, text.slice(0, bestIndex))) {
      return bestIndex;
    }

    offset = bestIndex + 1;
  }

  return -1;
}

function splitSafeContent(state, text) {
  // Check if text has partial DSML or tool marker
  const lastLt = text.lastIndexOf("<");
  if (lastLt >= 0) {
    const tail = text.slice(lastLt);
    if (!tail.includes(">") || /<\s*(\/?)\s*[|｜]+\s*DSML/i.test(tail) || /<\|\|DSML/i.test(tail) || /<\s*tool/i.test(tail)) {
      if (!isInsideCodeFence(state, text.slice(0, lastLt))) {
        return { safe: text.slice(0, lastLt), hold: text.slice(lastLt) };
      }
    }
  }

  return { safe: text, hold: "" };
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

  const openIndex = findToolOpen(captured);
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
    suffix: stripDsmlTrailer(captured.slice(closeEnd))
  };
}

function pushTextEvent(state, events, text) {
  if (!text) {
    return;
  }

  const cleanedText = stripDsmlTrailer(normalizeDsmlStream(text)).replace(/<[^>]*DSML[^>]*>/gi, "");
  if (!cleanedText) {
    return;
  }
  const combined = `${state.heldWhitespace}${cleanedText}`;
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
        // Preserve following tool calls in same response; drop only echoed results.
        state.pending = consumed.suffix ?? "";
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
      if (isDsmlMarker(state.pending) || isDsmlMarker(state.capture)) {
        const full = `${state.capture}${state.pending}`;
        const calls = parseToolCallsFromText(full, state.allowedToolNames);
        state.capture = "";
        state.pending = "";
        state.capturing = false;
        const events = [];
        if (calls.length) {
          pushToolCallsEvent(state, events, calls);
          return events;
        }
      }

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

      // If pending stream contains DSML tags, do not pass through partial text; buffer until complete or end
      if (isDsmlMarker(state.pending)) {
        const norm = normalizeDsmlStream(state.pending);
        const hasOpenCalls = /<\|DSML\|tool_calls\s*>/i.test(norm) || /<\|DSML\|calls\s*>/i.test(norm);
        const hasClosedCalls = /<\/\|DSML\|tool_calls\s*>/i.test(norm) || /<\/\|DSML\|calls\s*>/i.test(norm);

        // If open calls tag exists, only parse when calls closing tag is received
        if (hasOpenCalls) {
          if (hasClosedCalls) {
            const calls = parseToolCallsFromText(state.pending, state.allowedToolNames);
            const firstDsmlIndex = state.pending.search(/<\s*(\/?)\s*[|｜]+\s*DSML/i);
            const events = [];
            if (firstDsmlIndex > 0) {
              const textBefore = state.pending.slice(0, firstDsmlIndex);
              pushTextEvent(state, events, textBefore);
            }
            state.pending = "";
            state.capture = "";
            state.capturing = false;
            pushToolCallsEvent(state, events, calls);
            return events;
          }
          return [];
        }

        // Otherwise (no calls tag), check if each invoke is closed
        const invokeCount = (norm.match(/<\|DSML\|invoke/gi) || []).length;
        const closeInvokeCount = (norm.match(/<\/\|DSML\|invoke\s*>/gi) || []).length;

        if (invokeCount > 0 && closeInvokeCount >= invokeCount) {
          const calls = parseToolCallsFromText(state.pending, state.allowedToolNames);
          const firstDsmlIndex = state.pending.search(/<\s*(\/?)\s*[|｜]+\s*DSML/i);
          const events = [];
          if (firstDsmlIndex > 0) {
            const textBefore = state.pending.slice(0, firstDsmlIndex);
            pushTextEvent(state, events, textBefore);
          }
          state.pending = "";
          state.capture = "";
          state.capturing = false;
          pushToolCallsEvent(state, events, calls);
          return events;
        }

        return [];
      }

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
      .map((event) => stripDsmlTrailer(event.text))
      .join(""),
    toolCalls: events.flatMap((event) => event.type === "tool_calls" ? event.calls ?? [] : [])
  };
}
