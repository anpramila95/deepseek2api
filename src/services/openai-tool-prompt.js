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

function sanitizePromptBranding(text) {
  if (typeof text !== "string" || !text) {
    return text;
  }
  return text
    .replace(/You\s+run\s+on\s+Hermes\s+Agent\s*\(\s*by\s+Nous\s+Research\s*\)/gi, "You run on AI Agent")
    .replace(/\bHermes\s+Agent\s*\(\s*by\s+Nous\s+Research\s*\)/gi, "AI Agent")
    .replace(/\bHermes\s+Agent\b/gi, "AI Agent")
    .replace(/\bNous\s+Research\b/gi, "AI")
    .replace(/\bHermes\b/g, "DeepSeek Harness")
    .replace(/\bZed\s+coding\s+agent\b/gi, "coding agent")
    .replace(/\bZed\s+editor\b/gi, "editor")
    .replace(/\binside\s+Zed\b/gi, "inside the editor")
    .replace(/\bZed\b/g, "the editor");
}

function normalizeContentText(content) {
  if (typeof content === "string") {
    return sanitizePromptBranding(content);
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return sanitizePromptBranding(
    content
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
      .join("\n")
  );
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
  const toolCallId = toStringSafe(message?.tool_call_id).trim();
  const toolName = toolNameById.get(toolCallId) || toStringSafe(message?.name).trim();
  return content;
}

function normalizeMessageRole(role) {
  return role === "developer" ? "system" : role;
}

function compactOldToolResult(content) {
  if (typeof content !== "string" || content.length < 500) {
    return content;
  }

  const lines = content.split("\n");
  if (lines.length > 20) {
    const head = lines.slice(0, 5).join("\n");
    const tail = lines.slice(-3).join("\n");
    return `${head}\n\n[... Truncated ${lines.length - 8} lines of older tool output to optimize context ...]\n\n${tail}`;
  }

  const head = content.slice(0, 200);
  const tail = content.slice(-100);
  return `${head}\n\n[... Truncated older tool output ...]\n\n${tail}`;
}

function normalizeMessagesForPrompt(messages) {
  const toolNameById = new Map();

  const rawNormalized = (messages ?? []).flatMap((message) => {
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

  // Smart Compaction: Identify older tool messages and prune oversized outputs
  // Count how many tool messages from the end to keep intact (e.g. last 2 tool calls)
  let toolCountFromEnd = 0;
  for (let i = rawNormalized.length - 1; i >= 0; i--) {
    if (rawNormalized[i].role === "tool") {
      toolCountFromEnd++;
      // If it's not among the 2 most recent tool results, prune long text
      if (toolCountFromEnd > 2) {
        rawNormalized[i].content = compactOldToolResult(rawNormalized[i].content);
      }
    }
  }

  return rawNormalized;
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

const NO_TOOL_PROMPT = "No tools are available in this conversation. Answer directly in normal text. DO NOT invoke or output any tools, function calls, XML tags, or DSML markers (such as <tool>, <execute_code>, <｜｜DSML｜｜ invoke>, parameter, or calls).";

export function buildToolPrompt(policy, tools) {
  const allowed = new Set(policy.allowedToolNames);
  const toolSchemas = tools
    .filter((tool) => allowed.has(getToolName(tool)))
    .map(formatToolSchema)
    .filter(Boolean);

  if (!toolSchemas.length) {
    return NO_TOOL_PROMPT;
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
    "1) CRITICAL: If you call any tool, your response MUST contain ONLY <tool> tags. STOP IMMEDIATELY after the last </tool> tag. DO NOT generate mock results, DO NOT pretend to be the user or execution environment, DO NOT write 'TOOL: Tool result', DO NOT output file contents yourself.",
    "2) The tag body must be one strict JSON object; property names and string values use double quotes.",
    "3) Use an exact listed tool name and only argument fields from its schema.",
    "4) One tag is one call. Do not add any outer wrapper.",
    "5) Put each call in its own complete tag; never combine multiple calls in one tag.",
    "6) Emit only calls that can run now. Wait for tool results from the environment before proceeding.",
    "7) Do not use markdown fences. If no tool is needed, answer normally without a tool tag.",
    "8) NEVER output DSML tags or markers such as </｜｜DSML｜｜ invoke>, <｜｜DSML｜｜ invoke name=\"read_file\">, parameter, invoke, or calls. Use only the exact <tool name=\"TOOL_NAME\">{...}</tool> format above."
  ].join("\n");

  if (policy.mode === "required") {
    prompt += "\n9) For this response, you MUST call at least one tool.";
  }

  if (policy.mode === "forced") {
    prompt += `\n9) For this response, you MUST call exactly this tool: ${policy.forcedName}.`;
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
  if (policy.allowedToolNames.length > 0 && promptMessages.some((message) => message.role === "tool")) {
    promptMessages.push({
      role: "system",
      content: "The previous tool execution result is available in context. Use it to continue the task. Never quote, reproduce, or expose tool results, file contents, XML tags, TOOL: labels, or ASSISTANT: labels. Never call the same tool with the same arguments twice. A tool result means that call completed. Use existing results before requesting another read. If required information is already present, continue to edit or answer."
    });
  }

  return {
    prompt: buildPromptFromMessages(promptMessages),
    toolPrompt,
    toolChoicePolicy: policy,
    toolNames: policy.allowedToolNames
  };
}
