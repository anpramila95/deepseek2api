import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildChatCompletionPayload } from "../src/services/openai-bridge.js";
import {
  applyToolParsingMode,
  hasToolField,
  TOOL_PARSING_MODEL_ID
} from "../src/services/openai-tool-parsing-mode.js";
import { buildOpenAiPrompt } from "../src/services/openai-tool-prompt.js";

function moduleUrl(...segments) {
  return pathToFileURL(join(process.cwd(), ...segments)).href;
}

const modeServiceUrl = moduleUrl("src", "services", "tool-parsing-mode-service.js");
const settingsUrl = moduleUrl("src", "services", "system-settings-service.js");

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

function createRequestOptions() {
  const prompt = buildOpenAiPrompt({
    messages: [{ role: "user", content: "上海天气如何？" }],
    tools: [WEATHER_TOOL],
    toolChoice: "auto"
  });

  return {
    model: {
      id: "deepseek-reasoner",
      modelType: "default",
      thinkingEnabled: true,
      searchEnabled: false
    },
    ...prompt
  };
}

test("global and personal tool parsing states use global-or-owner resolution", () => {
  const directory = mkdtempSync(join(tmpdir(), "deepseek2api-tool-mode-"));

  try {
    mkdirSync(join(directory, "data"), { recursive: true });
    const script = [
      `const mode = await import(${JSON.stringify(modeServiceUrl)});`,
      `const settings = await import(${JSON.stringify(settingsUrl)});`,
      "settings.updateSystemSettings({ toolParsingModeEnabled: false });",
      "mode.setOwnerToolParsingModeEnabled('owner-a', true);",
      "const result = {",
      "  ownerA: mode.getToolParsingModeState('owner-a'),",
      "  ownerB: mode.getToolParsingModeState('owner-b')",
      "};",
      "settings.updateSystemSettings({ toolParsingModeEnabled: true });",
      "result.ownerBAfterGlobal = mode.getToolParsingModeState('owner-b');",
      "console.log(JSON.stringify(result));"
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PERSIST_ACCOUNT_CREDENTIALS: "false" }
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim());
    assert.deepEqual(payload.ownerA, {
      effectiveEnabled: true,
      globalEnabled: false,
      ownerEnabled: true
    });
    assert.deepEqual(payload.ownerB, {
      effectiveEnabled: false,
      globalEnabled: false,
      ownerEnabled: false
    });
    assert.deepEqual(payload.ownerBAfterGlobal, {
      effectiveEnabled: true,
      globalEnabled: true,
      ownerEnabled: false
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("structured tool fields trigger a fast-mode formatter but ordinary prose does not", () => {
  assert.equal(hasToolField('<tool name="weather">{"city":"Shanghai"}</tool>'), true);
  assert.equal(hasToolField('{"tool_call":{"name":"weather"}}'), true);
  assert.equal(hasToolField("tool_name: weather"), true);
  assert.equal(hasToolField("This tool is useful."), false);
});

test("tool parsing sends only the answer body and tool prompt to fast mode", async () => {
  const requestOptions = createRequestOptions();
  const initialCompletion = {
    content: '{"tool":{"name":"weather","arguments":{"city":"Shanghai"}}}',
    reasoningContent: "PRIVATE_REASONING_SHOULD_NOT_BE_FORWARDED"
  };
  let capturedRequest = null;

  const completion = await applyToolParsingMode({
    account: { id: "account-fixture" },
    completion: initialCompletion,
    enabled: true,
    requestOptions,
    collectCompletion: async (request) => {
      capturedRequest = request;
      return {
        content: '<tool name="weather">{"city":"Shanghai"}</tool>',
        reasoningContent: "IGNORED_FORMATTER_REASONING"
      };
    }
  });

  assert.equal(capturedRequest.deleteAfterFinish, true);
  assert.equal(capturedRequest.requestOptions.model.id, TOOL_PARSING_MODEL_ID);
  assert.equal(capturedRequest.requestOptions.model.thinkingEnabled, false);
  assert.match(capturedRequest.requestOptions.prompt, /Assistant draft to normalize/);
  assert.match(capturedRequest.requestOptions.prompt, /"name":"weather"/);
  assert.match(capturedRequest.requestOptions.prompt, /"tool":\{"name":"weather"/);
  assert.doesNotMatch(capturedRequest.requestOptions.prompt, /PRIVATE_REASONING_SHOULD_NOT_BE_FORWARDED/);
  assert.equal(completion.reasoningContent, initialCompletion.reasoningContent);

  const payload = buildChatCompletionPayload("chatcmpl-tool-parser", requestOptions, completion);
  assert.equal(payload.choices[0].finish_reason, "tool_calls");
  assert.equal(payload.choices[0].message.content, null);
  assert.equal(payload.choices[0].message.tool_calls[0].function.name, "weather");
  assert.equal(payload.choices[0].message.tool_calls[0].function.arguments, '{"city":"Shanghai"}');
});

test("tool parsing leaves regular answers on the original completion path", async () => {
  const completion = { content: "It is sunny.", reasoningContent: "reasoning" };
  let called = false;
  const result = await applyToolParsingMode({
    account: { id: "account-fixture" },
    completion,
    enabled: true,
    requestOptions: createRequestOptions(),
    collectCompletion: async () => {
      called = true;
      return { content: "unexpected" };
    }
  });

  assert.equal(called, false);
  assert.equal(result, completion);
});

test("tool parsing rejects formatter output that is not a formal declared call", async () => {
  await assert.rejects(
    applyToolParsingMode({
      account: { id: "account-fixture" },
      completion: { content: "tool_name: weather", reasoningContent: "" },
      enabled: true,
      requestOptions: createRequestOptions(),
      collectCompletion: async () => ({ content: "weather in prose" })
    }),
    (error) => error.statusCode === 502 && error.code === "tool_parsing_failed"
  );
});
