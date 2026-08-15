import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const apiKeyServiceUrl = pathToFileURL(
  join(process.cwd(), "src", "services", "api-key-service.js")
).href;
const openAiRoutesUrl = pathToFileURL(join(process.cwd(), "src", "routes", "openai-routes.js")).href;
const storeModuleUrl = pathToFileURL(join(process.cwd(), "src", "storage", "store.js")).href;

test("API key usage is persisted, incremented, and reset on a new local day", () => {
  const directory = mkdtempSync(join(tmpdir(), "deepseek2api-key-usage-"));

  try {
    const script = [
      `const apiKeys = await import(${JSON.stringify(apiKeyServiceUrl)});`,
      `const store = await import(${JSON.stringify(storeModuleUrl)});`,
      "const created = apiKeys.createApiKeyRecord({ ownerId: 'owner-1', accountId: 'account-1', label: 'test', plainKey: 'dsr_test_key' });",
      "apiKeys.recordApiKeyUsage(created.record.id);",
      "apiKeys.recordApiKeyUsage(created.record.id);",
      "const sameDay = apiKeys.listApiKeysForOwner('owner-1')[0];",
      "store.updateStore((state) => ({ ...state, apiKeys: state.apiKeys.map((key) => ({ ...key, usageDay: '2000-01-01', todayUsage: 99 })) }));",
      "const nextDay = apiKeys.recordApiKeyUsage(created.record.id);",
      "console.log(JSON.stringify({ sameDay, nextDay }));"
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env }
    });

    assert.equal(result.status, 0, result.stderr);
    const { sameDay, nextDay } = JSON.parse(result.stdout.trim());
    const persisted = JSON.parse(readFileSync(join(directory, "data", "app.json"), "utf8"));

    assert.equal(sameDay.todayUsage, 2);
    assert.equal(nextDay.todayUsage, 1);
    assert.equal(persisted.apiKeys[0].todayUsage, 1);
    assert.match(persisted.apiKeys[0].usageDay, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal("keyHash" in sameDay, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("authenticated OpenAI routes record API key usage", () => {
  const directory = mkdtempSync(join(tmpdir(), "deepseek2api-key-route-"));

  try {
    const script = [
      `const apiKeys = await import(${JSON.stringify(apiKeyServiceUrl)});`,
      `const routes = await import(${JSON.stringify(openAiRoutesUrl)});`,
      "apiKeys.createApiKeyRecord({ ownerId: 'owner-1', accountId: 'account-1', label: 'test', plainKey: 'dsr_route_key' });",
      "let statusCode = 0;",
      "const response = { writeHead(status) { statusCode = status; }, end() {} };",
      "const request = { method: 'GET', headers: { authorization: 'Bearer dsr_route_key' } };",
      "const handled = await routes.handleOpenAiRequest(request, response, new URL('http://localhost/v1/models'));",
      "const key = apiKeys.listApiKeysForOwner('owner-1')[0];",
      "console.log(JSON.stringify({ handled, statusCode, todayUsage: key.todayUsage }));"
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      handled: true,
      statusCode: 200,
      todayUsage: 1
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
