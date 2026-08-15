import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const storeModuleUrl = pathToFileURL(join(process.cwd(), "src", "storage", "store.js")).href;

test("store migration removes legacy plaintext secrets and persists account profiles", () => {
  const directory = mkdtempSync(join(tmpdir(), "deepseek2api-store-"));
  const dataDirectory = join(directory, "data");
  const dataFile = join(dataDirectory, "app.json");

  try {
    mkdirSync(dataDirectory, { recursive: true });
    writeFileSync(dataFile, JSON.stringify({
      accounts: [{
        id: "account-1",
        ownerId: "owner-1",
        deepseekUserId: "upstream-1",
        loginValue: "someone@example.com",
        password: "legacy-password",
        token: "upstream-token",
        deviceId: `B${"A".repeat(88)}`
      }],
      apiKeys: [{
        id: "key-1",
        ownerId: "owner-1",
        key: "sk-legacy-plaintext",
        keyHash: "hash-value"
      }]
    }, null, 2));

    const script = [
      `const { readStore } = await import(${JSON.stringify(storeModuleUrl)});`,
      "const first = readStore();",
      "const second = readStore();",
      "console.log(JSON.stringify({ first, second }));"
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PERSIST_ACCOUNT_CREDENTIALS: "false" }
    });

    assert.equal(result.status, 0, result.stderr);
    const { first, second } = JSON.parse(result.stdout.trim());
    const account = first.accounts[0];
    const apiKey = first.apiKeys[0];
    const persisted = JSON.parse(readFileSync(dataFile, "utf8"));

    assert.equal(account.loginValue, "so***@example.com");
    assert.equal(account.password, "");
    assert.equal(account.credentialMode, "ephemeral");
    assert.equal(account.deviceProfile.loginDeviceId, account.deviceId);
    assert.match(account.deviceProfile.clientDid, /^[0-9a-f-]{36}$/i);
    assert.equal("key" in apiKey, false);
    assert.equal(apiKey.keyHash, "hash-value");
    assert.deepEqual(second, first);
    assert.deepEqual(persisted, first);
    assert.doesNotMatch(readFileSync(dataFile, "utf8"), /legacy-password|sk-legacy-plaintext/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
