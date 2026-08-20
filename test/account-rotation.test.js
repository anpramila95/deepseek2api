import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const rotationServiceUrl = pathToFileURL(
  join(process.cwd(), "src", "services", "account-rotation-service.js")
).href;
const storeModuleUrl = pathToFileURL(join(process.cwd(), "src", "storage", "store.js")).href;

function runRotationScript(scriptLines) {
  const directory = mkdtempSync(join(tmpdir(), "deepseek2api-account-rotation-"));

  try {
    const script = [
      `const rotation = await import(${JSON.stringify(rotationServiceUrl)});`,
      `const store = await import(${JSON.stringify(storeModuleUrl)});`,
      ...scriptLines
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env }
    });

    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("API keys share one round-robin cursor across their owner's usable account pool", () => {
  const sequence = runRotationScript([
    "store.writeStore({ accounts: [",
    "  { id: 'owner-a-1', ownerId: 'owner-a', token: 'token-a-1', status: 'online' },",
    "  { id: 'owner-b-1', ownerId: 'owner-b', token: 'token-b-1', status: 'online' },",
    "  { id: 'owner-a-2', ownerId: 'owner-a', token: 'token-a-2', status: 'online' },",
    "  { id: 'owner-a-captcha', ownerId: 'owner-a', token: 'token-a-3', status: 'captcha_required' }",
    "] });",
    "const firstKey = { id: 'key-a-1', ownerId: 'owner-a', accountId: 'owner-a-2' };",
    "const secondKey = { id: 'key-a-2', ownerId: 'owner-a', accountId: 'owner-a-2' };",
    "console.log(JSON.stringify([",
    "  rotation.takeRoundRobinAccount(firstKey)?.id,",
    "  rotation.takeRoundRobinAccount(secondKey)?.id,",
    "  rotation.takeRoundRobinAccount(firstKey)?.id,",
    "  rotation.takeRoundRobinAccount(secondKey)?.id",
    "]));"
  ]);

  assert.deepEqual(sequence, ["owner-a-1", "owner-a-2", "owner-a-1", "owner-a-2"]);
});

test("closed shared-account mode keeps administrator API calls in the admin-owned pool", () => {
  const sequence = runRotationScript([
    "store.writeStore({ accounts: [",
    "  { id: 'other-1', ownerId: 'owner-a', token: 'token-other', status: 'online' },",
    "  { id: 'admin-1', ownerId: 'admin', token: 'token-admin-1', status: 'online' },",
    "  { id: 'admin-2', ownerId: 'admin', token: 'token-admin-2', status: 'online' }",
    "] });",
    "const key = { id: 'admin-key', ownerId: 'admin', accountId: 'other-1' };",
    "console.log(JSON.stringify([",
    "  rotation.takeRoundRobinAccount(key)?.id,",
    "  rotation.takeRoundRobinAccount(key)?.id,",
    "  rotation.takeRoundRobinAccount(key)?.id",
    "]));"
  ]);

  assert.deepEqual(sequence, ["admin-1", "admin-2", "admin-1"]);
});

test("open shared-account mode uses one global round-robin pool for every API key", () => {
  const sequence = runRotationScript([
    "store.writeStore({",
    "  accounts: [",
    "    { id: 'owner-a-1', ownerId: 'owner-a', token: 'token-a-1', status: 'online' },",
    "    { id: 'owner-b-1', ownerId: 'owner-b', token: 'token-b-1', status: 'online' },",
    "    { id: 'owner-a-2', ownerId: 'owner-a', token: 'token-a-2', status: 'online' }",
    "  ],",
    "  incognito: { globalEnabled: true, owners: {} },",
    "  sharedAccountMode: { enabled: true }",
    "});",
    "const firstKey = { id: 'key-a', ownerId: 'owner-a', accountId: 'owner-a-2' };",
    "const secondKey = { id: 'key-b', ownerId: 'owner-b', accountId: 'owner-b-1' };",
    "console.log(JSON.stringify([",
    "  rotation.takeRoundRobinAccount(firstKey)?.id,",
    "  rotation.takeRoundRobinAccount(secondKey)?.id,",
    "  rotation.takeRoundRobinAccount(firstKey)?.id,",
    "  rotation.takeRoundRobinAccount(secondKey)?.id",
    "]));"
  ]);

  assert.deepEqual(sequence, ["owner-a-1", "owner-b-1", "owner-a-2", "owner-a-1"]);
});

test("frequency retries advance from the account that just failed", () => {
  const sequence = runRotationScript([
    "store.writeStore({ accounts: [",
    "  { id: 'owner-a-1', ownerId: 'owner-a', token: 'token-a-1', status: 'online' },",
    "  { id: 'owner-a-2', ownerId: 'owner-a', token: 'token-a-2', status: 'online' },",
    "  { id: 'owner-a-3', ownerId: 'owner-a', token: 'token-a-3', status: 'online' }",
    "] });",
    "const key = { id: 'key-a', ownerId: 'owner-a' };",
    "const first = rotation.takeRoundRobinAccount(key);",
    "const second = rotation.takeNextRoundRobinAccount(key, first.id);",
    "const third = rotation.takeNextRoundRobinAccount(key, second.id);",
    "const wrapped = rotation.takeNextRoundRobinAccount(key, third.id);",
    "console.log(JSON.stringify([first.id, second.id, third.id, wrapped.id]));"
  ]);

  assert.deepEqual(sequence, ["owner-a-1", "owner-a-2", "owner-a-3", "owner-a-1"]);
});

test("frequency retries keep using the only account in the pool", () => {
  const sequence = runRotationScript([
    "store.writeStore({ accounts: [",
    "  { id: 'only-account', ownerId: 'owner-a', token: 'token-a', status: 'online' }",
    "] });",
    "const key = { id: 'key-a', ownerId: 'owner-a' };",
    "const first = rotation.takeRoundRobinAccount(key);",
    "const retry = rotation.takeNextRoundRobinAccount(key, first.id);",
    "console.log(JSON.stringify([first.id, retry.id]));"
  ]);

  assert.deepEqual(sequence, ["only-account", "only-account"]);
});
