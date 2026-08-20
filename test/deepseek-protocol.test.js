import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyProtocolResponse,
  computeRiskBackoffMs,
  createProtocolRequestContext,
  getProtocolManifest,
  resolveRetryAfterMs
} from "../src/services/deepseek-protocol.js";

test("protocol request context keeps local correlation IDs out of official browser headers", () => {
  const context = createProtocolRequestContext({
    token: "TOKEN",
    deviceProfile: {
      loginDeviceId: `B${"A".repeat(88)}`,
      clientDid: "123e4567-e89b-42d3-a456-426614174000",
      locale: "en_US",
      source: "fixture-web"
    }
  }, "/chat/completion", { method: "POST" });

  assert.match(context.requestId, /^[0-9a-f-]{36}$/i);
  assert.match(context.traceId, /^[0-9a-f-]{36}$/i);
  assert.equal(context.headers["x-request-id"], undefined);
  assert.equal(context.headers["x-trace-id"], undefined);
  assert.equal(context.headers["x-client-source"], undefined);
  assert.equal(context.headers["x-client-did"], undefined);
  assert.equal(context.headers["x-device-id"], undefined);
  assert.equal(context.headers.origin, "https://chat.deepseek.com");
  assert.equal(context.headers.referer, "https://chat.deepseek.com/");
  assert.equal(context.headers["sec-fetch-mode"], "cors");
  assert.equal(context.headers["sec-fetch-site"], "same-origin");
  assert.equal(context.headers.priority, "u=1, i");
});

test("same-origin GET context omits origin while retaining browser fetch metadata", () => {
  const context = createProtocolRequestContext({}, "/client/settings", { method: "GET" });

  assert.equal(context.headers.origin, undefined);
  assert.equal(context.headers["sec-fetch-dest"], "empty");
  assert.match(context.headers.accept, /application\/json/);
});

test("protocol response classifier separates auth, captcha and rate-limit challenges", () => {
  assert.equal(classifyProtocolResponse({ status: 401 }).kind, "auth");
  assert.equal(classifyProtocolResponse({ status: 429 }).kind, "rate_limit");
  assert.equal(classifyProtocolResponse({
    status: 400,
    payload: { msg: "captcha required" }
  }).kind, "captcha");
  assert.equal(classifyProtocolResponse({
    status: 403,
    payload: { msg: "captcha required" }
  }).kind, "captcha");
});

test("protocol manifest exposes versioned routes without credentials", () => {
  const manifest = getProtocolManifest();
  assert.equal(typeof manifest.apiVersion, "string");
  assert.ok(manifest.paths.some((path) => path.includes("/chat/completion")));
  assert.ok(manifest.knownPaths.includes("/client/settings/report"));
  assert.equal(resolveRetryAfterMs(new Headers({ "retry-after": "2" })), 2000);
  assert.ok(computeRiskBackoffMs(1, 0) >= computeRiskBackoffMs(0, 0));
});
