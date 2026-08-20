import assert from "node:assert/strict";
import test from "node:test";

import { parseToolCallsFromText } from "../src/services/openai-tool-parser.js";
import {
  createToolSieve,
  extractToolAwareOutput
} from "../src/services/openai-tool-sieve.js";

function summarizeCalls(calls) {
  return calls.map(({ name, argumentsText, input }) => ({ name, argumentsText, input }));
}

test("the compact format parses multiple flat tool tags", () => {
  const calls = parseToolCallsFromText([
    '<tool name="weather">{"city":"Shanghai"}</tool>',
    "<tool name='local_time'>{\"timezone\":\"Asia/Shanghai\"}</tool>"
  ].join("\n"), ["weather", "local_time"]);

  assert.deepEqual(summarizeCalls(calls), [
    {
      name: "weather",
      argumentsText: '{"city":"Shanghai"}',
      input: { city: "Shanghai" }
    },
    {
      name: "local_time",
      argumentsText: '{"timezone":"Asia/Shanghai"}',
      input: { timezone: "Asia/Shanghai" }
    }
  ]);
});

test("undeclared compact calls are filtered out", () => {
  const calls = parseToolCallsFromText([
    '<tool name="weather">{"city":"Shanghai"}</tool>',
    '<tool name="unknown">{"value":1}</tool>'
  ].join(""), ["weather"]);

  assert.deepEqual(summarizeCalls(calls), [
    {
      name: "weather",
      argumentsText: '{"city":"Shanghai"}',
      input: { city: "Shanghai" }
    }
  ]);
});

test("tool examples inside markdown fences are ignored", () => {
  const calls = parseToolCallsFromText(`
    \`\`\`xml
    <tool name="weather">{"city":"Example"}</tool>
    \`\`\`
    <tool name="weather">{"city":"Shanghai"}</tool>
  `, ["weather"]);

  assert.deepEqual(calls.map((call) => call.input), [{ city: "Shanghai" }]);
});

test("the removed nested format is not parsed", () => {
  const calls = parseToolCallsFromText(`
    <tool_calls>
      <tool_call>
        <tool_name>weather</tool_name>
        <parameters>{"city":"Shanghai"}</parameters>
      </tool_call>
    </tool_calls>
  `, ["weather"]);

  assert.deepEqual(calls, []);
});

test("a closing-tag sequence inside a JSON string does not truncate the call", () => {
  const text = '<tool name="search">{"query":"literal </tool> marker"}</tool>';
  const parsed = extractToolAwareOutput(text, ["search"]);

  assert.equal(parsed.content, "");
  assert.deepEqual(summarizeCalls(parsed.toolCalls), [
    {
      name: "search",
      argumentsText: '{"query":"literal </tool> marker"}',
      input: { query: "literal </tool> marker" }
    }
  ]);
});

test("the streaming sieve handles fragmented consecutive compact calls", () => {
  const sieve = createToolSieve(["weather", "local_time"]);
  const events = [];

  for (const chunk of [
    "<to",
    'ol name="weather">{"city":',
    '"Shanghai"}</tool>\n<tool name="local_time">',
    '{"timezone":"Asia/Shanghai"}</to',
    "ol>"
  ]) {
    events.push(...sieve.push(chunk));
  }
  events.push(...sieve.flush());

  assert.deepEqual(
    summarizeCalls(events.flatMap((event) => event.type === "tool_calls" ? event.calls : [])),
    [
      {
        name: "weather",
        argumentsText: '{"city":"Shanghai"}',
        input: { city: "Shanghai" }
      },
      {
        name: "local_time",
        argumentsText: '{"timezone":"Asia/Shanghai"}',
        input: { timezone: "Asia/Shanghai" }
      }
    ]
  );
  assert.equal(
    events.filter((event) => event.type === "text").map((event) => event.text).join(""),
    ""
  );
});

test("non-stream extraction returns all compact calls", () => {
  const parsed = extractToolAwareOutput([
    '<tool name="weather">{"city":"Shanghai"}</tool>',
    '<tool name="local_time">{"timezone":"Asia/Shanghai"}</tool>'
  ].join("\n"), ["weather", "local_time"]);

  assert.equal(parsed.content, "");
  assert.equal(parsed.toolCalls.length, 2);
});
