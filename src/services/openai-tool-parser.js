import { randomUUID } from "node:crypto";

const TOOL_OPEN_PATTERN = /<tool\b([^>]*)>/gi;
const TOOL_CLOSE_PATTERN = /<\/tool\s*>/gi;
const TOOL_ATTR_PATTERN = /(?:^|\s)name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

function toStringSafe(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function stripFencedCodeBlocks(text) {
  return toStringSafe(text).replace(/```[\s\S]*?```/g, " ");
}

function decodeXmlText(text) {
  return toStringSafe(text)
    .trim()
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#039;", "'")
    .replaceAll("&#x27;", "'");
}

function parseJsonObject(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function isInsideJsonString(text) {
  let escaped = false;
  let insideString = false;

  for (const character of toStringSafe(text)) {
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

function findToolClose(source, bodyStart) {
  TOOL_CLOSE_PATTERN.lastIndex = bodyStart;
  let match;

  while ((match = TOOL_CLOSE_PATTERN.exec(source))) {
    if (!isInsideJsonString(source.slice(bodyStart, match.index))) {
      return {
        end: match.index + match[0].length,
        index: match.index
      };
    }
  }

  return null;
}

function findToolName(attrs) {
  const match = toStringSafe(attrs).match(TOOL_ATTR_PATTERN);
  return decodeXmlText(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function createParsedToolCall(name, input) {
  return {
    id: `call_${randomUUID().replaceAll("-", "")}`,
    name,
    argumentsText: JSON.stringify(input),
    input
  };
}

function parseCompactToolCalls(source) {
  const output = [];
  TOOL_OPEN_PATTERN.lastIndex = 0;
  let match;

  while ((match = TOOL_OPEN_PATTERN.exec(source))) {
    const name = findToolName(match[1]);
    const bodyStart = match.index + match[0].length;
    const close = findToolClose(source, bodyStart);

    if (!close) {
      break;
    }

    const input = parseJsonObject(decodeXmlText(source.slice(bodyStart, close.index)));
    if (name && input) {
      output.push(createParsedToolCall(name, input));
    }

    TOOL_OPEN_PATTERN.lastIndex = close.end;
  }

  return output;
}

function filterAllowedToolCalls(calls, allowedToolNames) {
  if (!allowedToolNames?.length) {
    return calls;
  }

  const allowed = new Set(allowedToolNames.map((name) => toStringSafe(name).trim()).filter(Boolean));
  return calls.filter((call) => allowed.has(call.name));
}

export function parseToolCallsFromText(text, allowedToolNames = []) {
  const source = stripFencedCodeBlocks(text);
  if (!source.match(/<tool\b/i)) {
    return [];
  }

  return filterAllowedToolCalls(parseCompactToolCalls(source), allowedToolNames);
}
