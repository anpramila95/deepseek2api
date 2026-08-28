import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const dispatcherModuleUrl = pathToFileURL(join(process.cwd(), "src", "services", "proxy-dispatcher.js")).href;
const settingsModuleUrl = pathToFileURL(join(process.cwd(), "src", "services", "system-settings-service.js")).href;

test("resolveProxyDispatcher prioritizes account proxy over global proxies", () => {
  const directory = mkdtempSync(join(tmpdir(), "deepseek2api-proxy-"));
  try {
    mkdirSync(join(directory, "data"), { recursive: true });
    const script = [
      `const settings = await import(${JSON.stringify(settingsModuleUrl)});`,
      `const dispatcher = await import(${JSON.stringify(dispatcherModuleUrl)});`,
      "settings.updateSystemSettings({ globalProxies: ['http://global:8080'] });",
      "const agentSpecific = dispatcher.resolveProxyDispatcher('http://account:8080');",
      "const agentGlobal = dispatcher.resolveProxyDispatcher('');",
      "console.log(JSON.stringify({ specific: Boolean(agentSpecific), global: Boolean(agentGlobal) }));"
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PERSIST_ACCOUNT_CREDENTIALS: "false" }
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.specific, true);
    assert.equal(payload.global, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolveProxyDispatcher returns undefined when no account proxy and no global proxies", () => {
  const directory = mkdtempSync(join(tmpdir(), "deepseek2api-proxy-"));
  try {
    mkdirSync(join(directory, "data"), { recursive: true });
    const script = [
      `const dispatcher = await import(${JSON.stringify(dispatcherModuleUrl)});`,
      "const agent = dispatcher.resolveProxyDispatcher('');",
      "console.log(JSON.stringify({ agent: agent === undefined }));"
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PERSIST_ACCOUNT_CREDENTIALS: "false" }
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.agent, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
