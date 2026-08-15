import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readProjectFile(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("global and personal experimental override controls are present in the UI", () => {
  const html = readProjectFile("public/index.html");
  const actions = readProjectFile("public/actions.js");
  const services = readProjectFile("public/app-services.js");

  assert.match(html, /id="cot-override-toggle"/);
  assert.match(html, /思维链覆写模式（实验性）/);
  assert.match(html, /id="settings-cot-override"/);
  assert.match(html, /思维链覆写模式（实验性，全局）/);
  assert.match(actions, /chainOfThoughtOverrideEnabled/);
  assert.match(services, /\/api\/chain-of-thought-override/);
});
