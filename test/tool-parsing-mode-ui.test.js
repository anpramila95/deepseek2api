import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readProjectFile(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("personal and global tool parsing controls are wired into the UI", () => {
  const html = readProjectFile("public/index.html");
  const actions = readProjectFile("public/actions.js");
  const services = readProjectFile("public/app-services.js");
  const view = readProjectFile("public/view.js");

  assert.match(html, /id="tool-parsing-toggle"/);
  assert.match(html, /id="settings-tool-parsing-mode"/);
  assert.match(html, /工具解析模式（全局）/);
  assert.match(actions, /toolParsingModeEnabled/);
  assert.match(services, /\/api\/tool-parsing-mode/);
  assert.match(view, /state\.session\.toolParsingMode/);
});
