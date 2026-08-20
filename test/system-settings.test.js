import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const settingsModuleUrl = pathToFileURL(join(process.cwd(), "src", "services", "system-settings-service.js")).href;

test("chain-of-thought override setting survives a local settings update and read", () => {
  const directory = mkdtempSync(join(tmpdir(), "deepseek2api-settings-"));
  try {
    mkdirSync(join(directory, "data"), { recursive: true });
    const script = [
      `const settings = await import(${JSON.stringify(settingsModuleUrl)});`,
      "settings.updateSystemSettings({ chainOfThoughtOverrideEnabled: true });",
      "console.log(JSON.stringify(settings.getPublicSystemSettings()));"
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PERSIST_ACCOUNT_CREDENTIALS: "false" }
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.chainOfThoughtOverrideEnabled, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("global tool parsing setting survives a local settings update and read", () => {
  const directory = mkdtempSync(join(tmpdir(), "deepseek2api-settings-"));
  try {
    mkdirSync(join(directory, "data"), { recursive: true });
    const script = [
      `const settings = await import(${JSON.stringify(settingsModuleUrl)});`,
      "settings.updateSystemSettings({ toolParsingModeEnabled: true });",
      "console.log(JSON.stringify(settings.getPublicSystemSettings()));"
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PERSIST_ACCOUNT_CREDENTIALS: "false" }
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.toolParsingModeEnabled, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("input content limit survives a local settings update and read", () => {
  const directory = mkdtempSync(join(tmpdir(), "deepseek2api-settings-"));
  try {
    mkdirSync(join(directory, "data"), { recursive: true });
    const script = [
      `const settings = await import(${JSON.stringify(settingsModuleUrl)});`,
      "settings.updateSystemSettings({ inputContentLimit: 234567 });",
      "console.log(JSON.stringify(settings.getPublicSystemSettings()));"
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PERSIST_ACCOUNT_CREDENTIALS: "false" }
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.inputContentLimit, 234567);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy expert prompt setting migrates to the canonical override setting", () => {
  const directory = mkdtempSync(join(tmpdir(), "deepseek2api-settings-"));
  const dataDirectory = join(directory, "data");
  const dataFile = join(dataDirectory, "app.json");

  try {
    mkdirSync(dataDirectory, { recursive: true });
    writeFileSync(dataFile, JSON.stringify({
      systemSettings: {
        expertPromptSuffixEnabled: true
      }
    }, null, 2));

    const script = [
      `const settings = await import(${JSON.stringify(settingsModuleUrl)});`,
      "console.log(JSON.stringify(settings.getPublicSystemSettings()));"
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PERSIST_ACCOUNT_CREDENTIALS: "false" }
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim());
    const persisted = JSON.parse(readFileSync(dataFile, "utf8"));
    assert.equal(payload.chainOfThoughtOverrideEnabled, true);
    assert.equal(persisted.systemSettings.chainOfThoughtOverrideEnabled, true);
    assert.equal("expertPromptSuffixEnabled" in persisted.systemSettings, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
