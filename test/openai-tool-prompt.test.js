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

const TIME_TOOL = Object.freeze({
  type: "function",
  function: {
    name: "local_time",
    description: "Get the local time",
    parameters: {
      type: "object",
      properties: { timezone: { type: "string" } },
      required: ["timezone"]
    }
  }
});

test("tool instructions are injected immediately above the latest user message", () => {
  const { prompt, toolNames, toolPrompt } = buildOpenAiPrompt({
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
  const toolPromptIndex = prompt.indexOf("SYSTEM: You can call the tools in this JSON list:");
  const latestUserIndex = prompt.indexOf("USER: What is the weather in Shanghai?");

  assert.deepEqual(toolNames, ["weather"]);
  assert.match(toolPrompt, /"name":"weather"/);
  assert.ok(originalSystemIndex >= 0);
  assert.ok(toolPromptIndex > originalSystemIndex);
  assert.ok(toolPromptIndex < latestUserIndex);
  assert.equal(prompt.slice(toolPromptIndex, latestUserIndex).trimEnd().endsWith("USER:"), false);
});

test("multiple tool definitions use one compact JSON list and the flat tool tag protocol", () => {
  const { prompt, toolNames } = buildOpenAiPrompt({
    messages: [{ role: "user", content: "Compare the weather and local time." }],
    tools: [WEATHER_TOOL, TIME_TOOL],
    toolChoice: "required"
  });

  assert.deepEqual(toolNames, ["weather", "local_time"]);
  assert.match(prompt, /\[\{"name":"weather".*\{"name":"local_time"/);
  assert.match(prompt, /<tool name="TOOL_NAME">\{"argument":"value"\}<\/tool>/);
  assert.match(prompt, /repeat one complete tag per line/);
  assert.match(prompt, /MUST call at least one tool/);
  assert.doesNotMatch(prompt, /<tool_calls>/);
  assert.doesNotMatch(prompt, /<tool_name>/);
  assert.doesNotMatch(prompt, /<parameters>/);
});

test("assistant tool-call history is normalized to the compact flat format", () => {
  const { prompt } = buildOpenAiPrompt({
    messages: [
      { role: "user", content: "Check both." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_weather",
            type: "function",
            function: { name: "weather", arguments: "{\"city\":\"Shanghai\"}" }
          },
          {
            id: "call_time",
            type: "function",
            function: { name: "local_time", arguments: "{\"timezone\":\"Asia/Shanghai\"}" }
          }
        ]
      },
      { role: "tool", tool_call_id: "call_weather", content: "sunny" },
      { role: "tool", tool_call_id: "call_time", content: "12:00" },
      { role: "user", content: "Summarize." }
    ],
    tools: [WEATHER_TOOL, TIME_TOOL],
    toolChoice: "auto"
  });

  assert.match(
    prompt,
    /ASSISTANT: <tool name="weather">\{"city":"Shanghai"\}<\/tool>\n<tool name="local_time">\{"timezone":"Asia\/Shanghai"\}<\/tool>/
  );
  assert.match(prompt, /TOOL: Tool result for weather:\nsunny/);
  assert.match(prompt, /TOOL: Tool result for local_time:\n12:00/);
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
