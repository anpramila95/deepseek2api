import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const importServiceUrl = pathToFileURL(
  join(process.cwd(), "src", "services", "account-import-service.js")
).href;

function runImportFixture({ privacySucceeds }) {
  const directory = mkdtempSync(join(tmpdir(), "deepseek2api-account-import-"));
  mkdirSync(join(directory, "data"), { recursive: true });
  const script = `
    const { existsSync, readFileSync } = await import("node:fs");
    const requests = [];
    globalThis.fetch = async (url, options = {}) => {
      const pathname = new URL(url).pathname.replace(/^\\/api\\/v\\d+/, "");
      requests.push({
        pathname,
        body: options.body ? JSON.parse(String(options.body)) : null
      });
      const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" }
      });
      if (pathname === "/users/login") {
        return json({ code: 0, data: { biz_code: 0, biz_data: { user: {
          id: "deepseek-user", token: "TOKEN", email: "fixture@example.com", area_code: "+86"
        } } } });
      }
      if (pathname === "/users/update_settings") {
        return json(${privacySucceeds
          ? "{ code: 0, data: { biz_code: 0, biz_data: {} } }"
          : "{ code: 0, data: { biz_code: 1, biz_msg: 'privacy update failed' } }"});
      }
      if (pathname === "/client/settings") {
        return json({ code: 0, data: { biz_code: 0, biz_data: { id: 7 } } });
      }
      if (pathname === "/client/settings/report") {
        return json({ code: 0, data: { biz_code: 0, biz_data: {} } });
      }
      throw new Error("Unexpected request: " + pathname);
    };

    const { importDeepseekAccountForOwner } = await import(${JSON.stringify(importServiceUrl)});
    let error = "";
    try {
      await importDeepseekAccountForOwner({
        ownerId: "owner-fixture",
        loginValue: "fixture@example.com",
        password: "PASSWORD"
      });
    } catch (caught) {
      error = caught.message;
    }
    const dataPath = "./data/app.json";
    const state = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, "utf8")) : null;
    console.log(JSON.stringify({ error, requests, state }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, PERSIST_ACCOUNT_CREDENTIALS: "false" }
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("account import confirms data optimization is disabled before persistence", () => {
  const result = runImportFixture({ privacySucceeds: true });
  const paths = result.requests.map((request) => request.pathname);

  assert.equal(result.error, "");
  const updateSettingsReq = result.requests.find((r) => r.pathname === "/users/update_settings");
  assert.ok(updateSettingsReq, "update_settings request missing");
  assert.deepEqual(updateSettingsReq.body, { training_allowed: false });
  assert.ok(paths.indexOf("/users/update_settings") < paths.indexOf("/client/settings"));
  assert.equal(result.state.accounts.length, 1);
  assert.equal(result.state.accounts[0].dataOptimizationDisabled, true);
  assert.equal(result.state.accounts[0].trainingAllowed, false);
  assert.ok(result.state.accounts[0].lastPrivacyUpdate);
});

test("account import leaves no account when the privacy update is rejected", () => {
  const result = runImportFixture({ privacySucceeds: false });

  assert.match(result.error, /privacy update failed/i);
  const apiPaths = result.requests.map((request) => request.pathname).filter((p) => p !== "/sign_in");
  assert.deepEqual(apiPaths, [
    "/users/login",
    "/users/update_settings"
  ]);
  assert.equal(result.state, null);
});
