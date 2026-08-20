import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildChatCompletionPayload,
  buildChunkPayload,
  buildOpenAiTextDelta
} from "../src/services/openai-bridge.js";

const REQUEST_OPTIONS = Object.freeze({
  model: {
    id: "deepseek-reasoner",
    thinkingEnabled: true
  },
  toolChoicePolicy: { mode: "none" },
  toolNames: []
});

test("non-stream reasoner responses use message.reasoning_content", () => {
  const payload = buildChatCompletionPayload(
    "chatcmpl-fixture",
    REQUEST_OPTIONS,
    { content: "answer", reasoningContent: "reasoning" }
  );
  const message = payload.choices[0].message;

  assert.deepEqual(message, {
    role: "assistant",
    content: "answer",
    reasoning_content: "reasoning"
  });
  assert.doesNotMatch(JSON.stringify(payload), /<\/?think>/);
});

test("stream reasoner responses use delta.reasoning_content", () => {
  const delta = buildOpenAiTextDelta({ kind: "thinking", text: "reasoning delta" });
  const payload = buildChunkPayload(
    "chatcmpl-fixture",
    "deepseek-reasoner",
    delta
  );

  assert.deepEqual(payload.choices[0].delta, {
    reasoning_content: "reasoning delta"
  });
  assert.deepEqual(
    buildOpenAiTextDelta({ kind: "response", text: "answer delta" }),
    { content: "answer delta" }
  );
});

test("the OpenAI completion runner no longer emits legacy think tags", () => {
  const source = readFileSync(
    new URL("../src/services/openai-completion-runner.js", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(source, /<\/?think>|THINK_(?:OPEN|CLOSE)_TAG/);
});
