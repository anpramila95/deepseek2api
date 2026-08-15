import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenAiPrompt } from "../src/services/openai-tool-prompt.js";

const WEATHER_TOOL = Object.freeze({
  type: "function",
  function: {
    name: "weather",
    description: "Get the weather",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"]
    }
  }
});

test("tool instructions are injected immediately above the latest user message", () => {
  const { prompt, toolNames } = buildOpenAiPrompt({
    messages: [
      { role: "system", content: "Keep answers concise." },
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "What is the weather in Shanghai?" }
    ],
    tools: [WEATHER_TOOL],
    toolChoice: "auto"
  });

  const originalSystemIndex = prompt.indexOf("SYSTEM: Keep answers concise.");
  const toolPromptIndex = prompt.indexOf("SYSTEM: You have access to these tools:");
  const latestUserIndex = prompt.indexOf("USER: What is the weather in Shanghai?");

  assert.deepEqual(toolNames, ["weather"]);
  assert.ok(originalSystemIndex >= 0);
  assert.ok(toolPromptIndex > originalSystemIndex);
  assert.ok(toolPromptIndex < latestUserIndex);
  assert.equal(prompt.slice(toolPromptIndex, latestUserIndex).trimEnd().endsWith("USER:"), false);
});

test("tool instructions are omitted when tool_choice is none", () => {
  const { prompt, toolNames } = buildOpenAiPrompt({
    messages: [{ role: "user", content: "Hello" }],
    tools: [WEATHER_TOOL],
    toolChoice: "none"
  });

  assert.deepEqual(toolNames, []);
  assert.equal(prompt, "USER: Hello");
});
