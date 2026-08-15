export const DEFAULT_EXPERT_PROMPT_SUFFIX =
  "Please use an English chain of thought beginning with “We”";

function normalizeText(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

export function isExpertModelType(modelType) {
  const value = normalizeText(modelType).trim().toLowerCase();
  return value === "expert" || value.endsWith("-expert");
}

export function appendExpertPromptSuffix(
  prompt,
  { modelType, enabled = false, suffix = DEFAULT_EXPERT_PROMPT_SUFFIX } = {}
) {
  const rawText = normalizeText(prompt);
  const text = rawText.trimEnd();
  const resolvedSuffix = normalizeText(suffix).trim();

  if (!enabled || !isExpertModelType(modelType) || !resolvedSuffix) {
    return rawText;
  }

  if (text === resolvedSuffix || text.endsWith(`\n${resolvedSuffix}`)) {
    return text;
  }

  return text ? `${text}\n\n${resolvedSuffix}` : resolvedSuffix;
}

export function appendExpertPromptSuffixToPayload(payload, options = {}) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const modelType = payload.model_type ?? payload.model;
  return {
    ...payload,
    prompt: appendExpertPromptSuffix(payload.prompt, {
      ...options,
      modelType
    })
  };
}
