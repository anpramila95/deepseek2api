import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

function moduleUrl(...segments) {
  return pathToFileURL(join(process.cwd(), ...segments)).href;
}

const configUrl = moduleUrl("src", "config.js");
const overrideUrl = moduleUrl("src", "services", "chain-of-thought-override-service.js");
const expertPromptUrl = moduleUrl("src", "services", "expert-prompt-service.js");
const openAiBridgeUrl = moduleUrl("src", "services", "openai-bridge.js");
const proxyRoutesUrl = moduleUrl("src", "routes", "proxy-routes.js");
const settingsUrl = moduleUrl("src", "services", "system-settings-service.js");

test("global and personal override states are isolated and applied by caller owner", () => {
  const directory = mkdtempSync(join(tmpdir(), "deepseek2api-cot-"));

  try {
    mkdirSync(join(directory, "data"), { recursive: true });
    const script = [
      `const configModule = await import(${JSON.stringify(configUrl)});`,
      `const overrides = await import(${JSON.stringify(overrideUrl)});`,
      `const expertPrompt = await import(${JSON.stringify(expertPromptUrl)});`,
      `const openAi = await import(${JSON.stringify(openAiBridgeUrl)});`,
      `const proxy = await import(${JSON.stringify(proxyRoutesUrl)});`,
      `const settings = await import(${JSON.stringify(settingsUrl)});`,
      "settings.updateSystemSettings({ chainOfThoughtOverrideEnabled: false });",
      "overrides.setOwnerChainOfThoughtOverrideEnabled('owner-a', true);",
      "const targetPath = configModule.resolveDeepseekApiPath('/chat/completion');",
      "const makeNative = (ownerId) => proxy.resolveChatCompletionRequest({",
      "  body: Buffer.from(JSON.stringify({ model_type: 'expert', prompt: 'native prompt' })),",
      "  method: 'POST',",
      "  ownerId,",
      "  targetPath",
      "});",
      "const makeOpenAi = (ownerId) => openAi.resolveCompletionRequest({",
      "  body: { model: 'deepseek-chat-expert', messages: [{ role: 'user', content: 'openai prompt' }] },",
      "  ownerId,",
      "  toolCallsEnabled: false",
      "});",
      "const suffix = expertPrompt.DEFAULT_EXPERT_PROMPT_SUFFIX;",
      "const result = {",
      "  ownerAState: overrides.getChainOfThoughtOverrideState('owner-a'),",
      "  ownerBState: overrides.getChainOfThoughtOverrideState('owner-b'),",
      "  nativeAEnabled: makeNative('owner-a').payload.prompt.endsWith(suffix),",
      "  nativeBEnabled: makeNative('owner-b').payload.prompt.endsWith(suffix),",
      "  openAiAEnabled: makeOpenAi('owner-a').prompt.endsWith(suffix),",
      "  openAiBEnabled: makeOpenAi('owner-b').prompt.endsWith(suffix)",
      "};",
      "settings.updateSystemSettings({ chainOfThoughtOverrideEnabled: true });",
      "result.ownerBAfterGlobal = overrides.getChainOfThoughtOverrideState('owner-b');",
      "console.log(JSON.stringify(result));"
    ].join("\n");
    const processResult = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PERSIST_ACCOUNT_CREDENTIALS: "false" }
    });

    assert.equal(processResult.status, 0, processResult.stderr);
    const result = JSON.parse(processResult.stdout.trim());
    assert.deepEqual(result.ownerAState, {
      effectiveEnabled: true,
      globalEnabled: false,
      ownerEnabled: true
    });
    assert.deepEqual(result.ownerBState, {
      effectiveEnabled: false,
      globalEnabled: false,
      ownerEnabled: false
    });
    assert.equal(result.nativeAEnabled, true);
    assert.equal(result.nativeBEnabled, false);
    assert.equal(result.openAiAEnabled, true);
    assert.equal(result.openAiBEnabled, false);
    assert.deepEqual(result.ownerBAfterGlobal, {
      effectiveEnabled: true,
      globalEnabled: true,
      ownerEnabled: false
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
