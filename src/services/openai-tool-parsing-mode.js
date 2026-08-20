import { buildPromptFromMessages } from "../utils/prompt.js";
import { collectCompletionContent } from "./openai-completion-runner.js";
import { createOpenAiError } from "./openai-error.js";
import { resolveOpenAiModel } from "./openai-request.js";
import { extractToolAwareOutput } from "./openai-tool-sieve.js";

export const TOOL_PARSING_MODEL_ID = "deepseek-chat";

const TOOL_FIELD_PATTERNS = Object.freeze([
  /<\s*\/?\s*tool(?:[_:-](?:calls?|name|use))?\b/i,
  /["']tool(?:[_-](?:calls?|name|use))?["']\s*:/i,
  /(?:^|[\s,{])tool(?:[_-](?:calls?|name|use))?\s*[:=]/im
]);

function toStringSafe(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

export function hasToolField(text) {
  const source = toStringSafe(text);
  return TOOL_FIELD_PATTERNS.some((pattern) => pattern.test(source));
}

export function shouldRunToolParsingMode({ completion, enabled, requestOptions }) {
  return Boolean(
    enabled
    && requestOptions?.toolNames?.length
    && requestOptions?.toolPrompt
    && hasToolField(completion?.content)
  );
}

export function buildToolParsingRequestOptions({ content, requestOptions }) {
  const formatterInstruction = [
    "Act as the final tool-call formatter for an assistant draft.",
    "The draft contains a tool field and must be converted into one or more valid tool tags.",
    "Use only tool intent and argument values present in the draft; do not answer the original user request.",
    "Return tool tags only, with no explanation, markdown, analysis, or surrounding prose.",
    "You MUST emit at least one valid tool tag."
  ].join("\n");

  return {
    model: resolveOpenAiModel(TOOL_PARSING_MODEL_ID),
    prompt: buildPromptFromMessages([
      {
        role: "system",
        content: `${requestOptions.toolPrompt}\n\n${formatterInstruction}`
      },
      {
        role: "user",
        content: `Assistant draft to normalize:\n${toStringSafe(content)}`
      }
    ]),
    imageInputs: [],
    refFileIds: [],
    toolChoicePolicy: requestOptions.toolChoicePolicy,
    toolNames: requestOptions.toolNames,
    toolPrompt: requestOptions.toolPrompt
  };
}

export async function applyToolParsingMode({
  account,
  collectCompletion = collectCompletionContent,
  completion,
  enabled = false,
  requestOptions
}) {
  if (!shouldRunToolParsingMode({ completion, enabled, requestOptions })) {
    return completion;
  }

  const parserCompletion = await collectCompletion({
    account,
    deleteAfterFinish: true,
    requestOptions: buildToolParsingRequestOptions({
      content: completion.content,
      requestOptions
    })
  });
  const parsed = extractToolAwareOutput(parserCompletion.content, requestOptions.toolNames);

  if (!parsed.toolCalls.length) {
    throw createOpenAiError(
      502,
      "Tool parsing mode did not produce a valid tool call.",
      "tool_parsing_failed"
    );
  }

  return {
    ...completion,
    content: parserCompletion.content
  };
}
