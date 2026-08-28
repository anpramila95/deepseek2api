import { randomUUID } from "node:crypto";

const TOOL_XML_PATTERN = /<(?:tool|tool_call|function_call)\b(?:\s+name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?[^>]*>([\s\S]*?)<\/(?:tool|tool_call|function_call)\s*>/gi;
const EXECUTE_CODE_PATTERN = /<execute_code\b[^>]*>([\s\S]*?)<\/execute_code\s*>/gi;
const JSON_BLOCK_PATTERN = /```(?:json)?\s*([\s\S]*?)\s*```/gi;

function toStringSafe(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function parseJsonObject(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    // Thử trích xuất JSON object nằm giữa dấu { và }
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        const sub = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
        return sub && typeof sub === "object" && !Array.isArray(sub) ? sub : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeDsmlToolTags(text) {
  return toStringSafe(text)
    .replace(/<\|\s*DSML\s*\|>\s*(?:tool\s+)?name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))\s*>/gi, (_match, doubleName, singleName, bareName) => {
      const name = doubleName ?? singleName ?? bareName ?? "";
      return `<tool name="${name}">`;
    })
    .replace(/<\|\s*DSML\s*\|>\s*\/?>/gi, "")
    .replace(/<\|\s*DSML\s*\|>\s*\/\s*>/gi, "</tool>")
    .replace(/<\|\s*DSML\s*\|>\s*\|>/gi, "</tool>");
}

function createParsedToolCall(name, input) {
  return {
    id: `call_${randomUUID().replaceAll("-", "")}`,
    name: toStringSafe(name).trim(),
    argumentsText: JSON.stringify(input ?? {}),
    input: input ?? {}
  };
}

function parseXmlToolCalls(source) {
  const output = [];
  TOOL_XML_PATTERN.lastIndex = 0;
  let match;

  while ((match = TOOL_XML_PATTERN.exec(source))) {
    let name = match[1] ?? match[2] ?? match[3] ?? "";
    const rawBody = match[4] ?? "";
    let input = parseJsonObject(rawBody);

    // Nếu name không có ở attribute, thử tìm trong body JSON
    if (!name && input?.name) {
      name = input.name;
      input = typeof input.arguments === "object" ? input.arguments : (parseJsonObject(input.arguments) || input.parameters || {});
    }

    if (name && input) {
      output.push(createParsedToolCall(name, input));
    }
  }

  EXECUTE_CODE_PATTERN.lastIndex = 0;
  let codeMatch;
  while ((codeMatch = EXECUTE_CODE_PATTERN.exec(source))) {
    const rawCode = (codeMatch[1] ?? "").trim();
    // Bỏ qua markdown wrapper ```python ... ``` nếu có
    const cleanedCode = rawCode.replace(/^```(?:python|py)?\s*/i, "").replace(/\s*```$/, "");
    output.push(createParsedToolCall("code_interpreter", { code: cleanedCode }));
    output.push(createParsedToolCall("execute_code", { code: cleanedCode }));
    output.push(createParsedToolCall("python", { code: cleanedCode }));
  }

  return output;
}

function parseJsonToolCalls(source) {
  const output = [];
  
  // 1. Quét JSON bên trong markdown fences
  JSON_BLOCK_PATTERN.lastIndex = 0;
  let blockMatch;
  while ((blockMatch = JSON_BLOCK_PATTERN.exec(source))) {
    const parsed = parseJsonObject(blockMatch[1]);
    if (parsed) {
      if (parsed.name && (parsed.arguments || parsed.parameters || parsed.input)) {
        const args = typeof parsed.arguments === "object" ? parsed.arguments : (parseJsonObject(parsed.arguments) || parsed.parameters || parsed.input || {});
        output.push(createParsedToolCall(parsed.name, args));
      } else if (Array.isArray(parsed.tool_calls)) {
        for (const call of parsed.tool_calls) {
          const fn = call.function || call;
          if (fn?.name) {
            const args = typeof fn.arguments === "object" ? fn.arguments : (parseJsonObject(fn.arguments) || {});
            output.push(createParsedToolCall(fn.name, args));
          }
        }
      }
    }
  }

  return output;
}

function filterAllowedToolCalls(calls, allowedToolNames) {
  const allowed = allowedToolNames?.length
    ? new Set(allowedToolNames.map((name) => toStringSafe(name).trim()).filter(Boolean))
    : null;
  const seen = new Set();

  return calls.filter((call) => {
    if (allowed && !allowed.has(call.name)) {
      return false;
    }

    const key = `${call.name}:${call.argumentsText}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function parseToolCallsFromText(text, allowedToolNames = []) {
  const source = normalizeDsmlToolTags(text);
  if (!source) return [];

  // Parse cả XML tags và JSON tool blocks
  const xmlCalls = parseXmlToolCalls(source);
  if (xmlCalls.length > 0) {
    return filterAllowedToolCalls(xmlCalls, allowedToolNames);
  }

  const jsonCalls = parseJsonToolCalls(source);
  if (jsonCalls.length > 0) {
    return filterAllowedToolCalls(jsonCalls, allowedToolNames);
  }

  return [];
}
