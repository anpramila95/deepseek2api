import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EXPERT_PROMPT_SUFFIX,
  appendExpertPromptSuffix,
  appendExpertPromptSuffixToPayload
} from "../src/services/expert-prompt-service.js";

test("expert suffix is appended only when enabled for expert models", () => {
  const prompt = "USER: Explain the result";
  assert.equal(
    appendExpertPromptSuffix(prompt, { modelType: "expert", enabled: true }),
    `${prompt}\n\n${DEFAULT_EXPERT_PROMPT_SUFFIX}`
  );
  assert.equal(
    appendExpertPromptSuffix(prompt, { modelType: "default", enabled: true }),
    prompt
  );
  assert.equal(
    appendExpertPromptSuffix(prompt, { modelType: "expert", enabled: false }),
    prompt
  );
  assert.equal(
    appendExpertPromptSuffix("prompt  ", { modelType: "default", enabled: false }),
    "prompt  "
  );
});

test("expert suffix injection is idempotent and preserves payload fields", () => {
  const payload = {
    model_type: "expert",
    prompt: `hello\n\n${DEFAULT_EXPERT_PROMPT_SUFFIX}`,
    stream: true
  };
  const result = appendExpertPromptSuffixToPayload(payload, { enabled: true });
  assert.deepEqual(result, payload);
});
