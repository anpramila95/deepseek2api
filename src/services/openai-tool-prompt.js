import { buildPromptFromMessages } from "../utils/prompt.js";
import { getToolFunction, getToolName, resolveToolChoicePolicy } from "./openai-tool-policy.js";

function toStringSafe(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function toJsonText(value, fallback = "{}") {
  if (typeof value === "string") {
    return value.trim() || fallback;
  }

  try {
    return JSON.stringify(value ?? {}) || fallback;
  } catch {
    return fallback;
  }
}

function escapeXmlAttribute(text) {
  return toStringSafe(text)
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeContentText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }

      if (typeof item.text === "string") {
        return item.text;
      }

      if (typeof item.output_text === "string") {
        return item.output_text;
      }

      if (typeof item.content === "string") {
        return item.content;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}


function formatPromptToolCalls(toolCalls, toolNameById) {
  if (!Array.isArray(toolCalls) || !toolCalls.length) {
    return "";
  }

  const blocks = toolCalls
    .map((call) => {
      const name = getToolName(call);
      const callId = toStringSafe(call?.id).trim();
      const argumentsText = toJsonText(getToolFunction(call)?.arguments ?? getToolFunction(call)?.input);

      if (!name) {
        return "";
      }

      if (callId) {
        toolNameById.set(callId, name);
      }

      return `<tool name="${escapeXmlAttribute(name)}">${argumentsText}</tool>`;
    })
    .filter(Boolean);

  return blocks.join("\n");
}

function normalizeAssistantPromptContent(message, toolNameById) {
  const content = normalizeContentText(message?.content).trim();
  const toolHistory = formatPromptToolCalls(message?.tool_calls, toolNameById);

  if (!content) {
    return toolHistory;
  }

  if (!toolHistory) {
    return content;
  }

  return `${content}\n\n${toolHistory}`;
}

function normalizeToolPromptContent(message, toolNameById) {
  const content = normalizeContentText(message?.content).trim() || "null";
  const toolName = toolNameById.get(toStringSafe(message?.tool_call_id).trim()) || toStringSafe(message?.name).trim();
  return toolName ? `Tool result for ${toolName}:\n${content}` : content;
}

function normalizeMessageRole(role) {
  return role === "developer" ? "system" : role;
}

function normalizeMessagesForPrompt(messages) {
  const toolNameById = new Map();

  return (messages ?? []).flatMap((message) => {
    const role = normalizeMessageRole(toStringSafe(message?.role).trim().toLowerCase() || "user");

    if (role === "assistant") {
      const content = normalizeAssistantPromptContent(message, toolNameById);
      return content ? [{ role, content }] : [];
    }

    if (role === "tool" || role === "function") {
      return [{ role: "tool", content: normalizeToolPromptContent(message, toolNameById) }];
    }

    return [{ role, content: normalizeContentText(message?.content) }];
  });
}

function formatToolSchema(tool) {
  const definition = getToolFunction(tool);
  const name = getToolName(tool);
  if (!name) {
    return null;
  }

  return {
    name,
    description: toStringSafe(definition?.description).trim(),
    parameters: definition?.parameters ?? {}
  };
}

export function buildToolPrompt(policy, tools) {
  const allowed = new Set(policy.allowedToolNames);
  const toolSchemas = tools
    .filter((tool) => allowed.has(getToolName(tool)))
    .map(formatToolSchema)
    .filter(Boolean);

  if (!toolSchemas.length) {
    return "";
  }

  let prompt = [
    "You can call the tools in this JSON list:",
    toJsonText(toolSchemas, "[]"),
    "",
    "Tool-call format:",
    "<tool name=\"TOOL_NAME\">{\"argument\":\"value\"}</tool>",
    "",
    "For multiple independent calls, repeat one complete tag per line:",
    "<tool name=\"FIRST_TOOL\">{\"argument\":\"value\"}</tool>",
    "<tool name=\"SECOND_TOOL\">{\"argument\":\"value\"}</tool>",
    "",
    "Rules:",
    "1) If you call any tool, output only tool tags and no prose.",
    "2) The tag body must be one strict JSON object; property names and string values use double quotes.",
    "3) Use an exact listed tool name and only argument fields from its schema.",
    "4) One tag is one call. Do not add any outer wrapper.",
    "5) Put each call in its own complete tag; never combine multiple calls in one tag.",
    "6) Emit only calls that can run now. Wait for tool results before making dependent calls.",
    "7) Do not use markdown fences. If no tool is needed, answer normally without a tool tag."
  ].join("\n");

  if (policy.mode === "required") {
    prompt += "\n8) For this response, you MUST call at least one tool.";
  }

  if (policy.mode === "forced") {
    prompt += `\n8) For this response, you MUST call exactly this tool: ${policy.forcedName}.`;
  }

  return prompt;
}

function injectToolPrompt(messages, toolPrompt) {
  if (!toolPrompt) {
    return messages;
  }

  let userIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      userIndex = index;
      break;
    }
  }

  const insertionIndex = userIndex === -1 ? messages.length : userIndex;
  return [
    ...messages.slice(0, insertionIndex),
    { role: "system", content: toolPrompt },
    ...messages.slice(insertionIndex)
  ];
}

export function buildOpenAiPrompt({ messages, toolChoice, tools }) {
  const policy = resolveToolChoicePolicy({ tools, toolChoice });
  const normalizedMessages = normalizeMessagesForPrompt(messages);
  const toolPrompt = buildToolPrompt(policy, tools ?? []);
  const promptMessages = injectToolPrompt(normalizedMessages, toolPrompt);

  return {
    prompt: buildPromptFromMessages(promptMessages),
    toolPrompt,
    toolChoicePolicy: policy,
    toolNames: policy.allowedToolNames
  };
}
