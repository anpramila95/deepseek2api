import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const publicFile = (name) => readFileSync(join(process.cwd(), "public", name), "utf8");

test("long session lists keep each title row from shrinking away", () => {
  const css = publicFile("app.css");
  assert.match(css, /\.session-item\s*\{[\s\S]*?flex:\s*0 0 auto;/);
  assert.match(css, /\.session-item\s*\{[\s\S]*?min-height:\s*68px;/);
});

test("thinking sections use closed details elements for static and streaming messages", () => {
  const staticRenderer = publicFile("deepseek-message.js");
  const streamingRenderer = publicFile("message-list-view.js");

  assert.match(staticRenderer, /<details class="message-section thinking"/);
  assert.doesNotMatch(staticRenderer, /<details[^>]*\sopen(?:\s|=|>)/);
  assert.match(streamingRenderer, /createElement\(kind === "thinking" \? "details" : "div"\)/);
  assert.match(streamingRenderer, /createElement\("summary"\)/);
});

test("native select options have explicit contrasting colors", () => {
  const css = publicFile("app.css");
  assert.match(css, /select option,[\s\S]*?background:\s*var\(--paper\);[\s\S]*?color:\s*var\(--ink\);/);
});

test("opening the API key tab refreshes the displayed daily usage", () => {
  const app = publicFile("app.js");
  const services = publicFile("app-services.js");

  assert.match(services, /requestJson\("\/api\/api-keys"\)/);
  assert.match(app, /event\.detail\?\.tab === "keys"[\s\S]*?services\.loadApiKeys\(\)/);
});
