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
  let source = toStringSafe(text).replace(
    /<[/|｜]*\s*DSML\s*[/|｜]+\s*(?:tool\s+)?name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))\s*>/gi,
    (_match, doubleName, singleName, bareName) => {
      const name = doubleName ?? singleName ?? bareName ?? "";
      return `<tool name="${name}">`;
    }
  );

  const invokeMarker = /<[^>]*DSML[^>]*invoke\s+name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))\s*>/gi;
  const closeMarker = /<[^>]*DSML[^>]*parameter\s*>/gi;
  const dsmlMarker = /<[^>]*DSML[^>]*(?:parameter|invoke|calls?)[^>]*>/gi;
  let openTools = 0;
  source = source.replace(/<\/?tool\b[^>]*>/gi, (tag) => {
    if (/^<\/tool\b/i.test(tag)) {
      openTools = Math.max(0, openTools - 1);
    } else {
      openTools += 1;
    }
    return tag;
  });

  source = source.replace(invokeMarker, (_match, doubleName, singleName, bareName) => {
    const name = doubleName ?? singleName ?? bareName ?? "";
    openTools += 1;
    return `<tool name="${name}">`;
  });
  source = source.replace(closeMarker, () => {
    if (openTools > 0) {
      openTools -= 1;
      return "</tool>";
    }
    return "";
  });
  source = source.replace(dsmlMarker, "");

  return source;
}

export function normalizeDsmlTokenVariants(text) {
  const doublePipe = "(?:\\|\\s*\\||｜\\s*｜)";
  let result = toStringSafe(text)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");

  // <||DSML||tag> or < | | DSML | | tag > -> <|DSML|tag>
  result = result.replace(
    new RegExp(`<\\s*(/?)\\s*${doublePipe}\\s*DSML\\s*${doublePipe}\\s*([A-Za-z_][\\w]*)\\s*>`, "gi"),
    "<$1|DSML|$2>"
  );

  // <||DSML||tag ... -> <|DSML|tag ...
  result = result.replace(
    new RegExp(`<\\s*(/?)\\s*${doublePipe}\\s*DSML\\s*${doublePipe}\\s*([A-Za-z_][\\w]*)\\s+`, "gi"),
    "<$1|DSML|$2 "
  );

  // Normalize tool_calls / calls synonyms
  result = result.replace(/<\s*(\/?)\s*\|DSML\|calls\b/gi, "<$1|DSML|tool_calls");

  return result;
}

function parseDsmlParameterCalls(text) {
  const output = [];
  const normalized = normalizeDsmlTokenVariants(text);
  const pattern = /<\|DSML\|invoke\s+name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))\s*>([\s\S]*?)<\/?\|DSML\|invoke\s*>/gi;
  let match;
  while ((match = pattern.exec(normalized))) {
    const toolName = match[1] ?? match[2] ?? match[3] ?? "";
    const body = match[4] ?? "";
    const input = {};
    const parameterPattern = /<\|DSML\|parameter\s+name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/?\|DSML\|parameter\s*>/gi;
    let parameter;
    while ((parameter = parameterPattern.exec(body))) {
      const parameterName = parameter[1] ?? parameter[2] ?? parameter[3] ?? "";
      if (parameterName) {
        let val = parameter[4] ?? "";
        val = val.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        if (/^(?:\{[\s\S]*\}|\[[\s\S]*\]|true|false|\d+(?:\.\d+)?)$/i.test(val.trim())) {
          try {
            input[parameterName] = JSON.parse(val.trim());
          } catch {
            input[parameterName] = val;
          }
        } else {
          input[parameterName] = val;
        }
      }
    }
    if (toolName && Object.keys(input).length) output.push({ toolName, input });
  }
  return output;
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
  if (!text) return [];

  const dsmlCalls = parseDsmlParameterCalls(text)
    .map(({ toolName, input }) => createParsedToolCall(toolName, input));
  if (dsmlCalls.length) {
    return filterAllowedToolCalls(dsmlCalls, allowedToolNames);
  }

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
