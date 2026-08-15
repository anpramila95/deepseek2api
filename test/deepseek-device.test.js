import assert from "node:assert/strict";
import test from "node:test";

import { createBaseHeaders } from "../src/services/deepseek-auth.js";
import {
  createSimulatedClientProfile,
  generateClientDid,
  generateDeepseekDeviceId,
  isClientDid,
  isDeepseekDeviceId,
  resolveDeepseekClientProfile
} from "../src/services/deepseek-device.js";

test("generated DeepSeek identifiers use the expected independent formats", () => {
  const loginDeviceId = generateDeepseekDeviceId();
  const clientDid = generateClientDid();

  assert.equal(isDeepseekDeviceId(loginDeviceId), true);
  assert.equal(isClientDid(clientDid), true);
  assert.notEqual(loginDeviceId, clientDid);
});

test("new simulated profiles receive independent environment and device values", () => {
  const first = createSimulatedClientProfile();
  const second = createSimulatedClientProfile();

  assert.notEqual(first.loginDeviceId, second.loginDeviceId);
  assert.match(first.fingerprintHash, /^[0-9a-f]{64}$/i);
  assert.equal(first.environment.fingerprintHash, undefined);
  assert.equal(first.environment.fingerprint, first.fingerprint);
});

test("resolved client profiles preserve a stable account identity", () => {
  const original = createSimulatedClientProfile({
    loginDeviceId: `B${"A".repeat(88)}`,
    clientDid: "123e4567-e89b-42d3-a456-426614174000",
    userAgent: "DeepSeek2API-Test/1.0",
    secChUaPlatform: '"Windows"',
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  const resolved = resolveDeepseekClientProfile({ deviceProfile: original });

  assert.equal(resolved.loginDeviceId, original.loginDeviceId);
  assert.equal(resolved.clientDid, original.clientDid);
  assert.equal(resolved.userAgent, original.userAgent);
  assert.equal(resolved.createdAt, original.createdAt);
  assert.deepEqual(resolved.fingerprint, original.fingerprint);
  assert.equal(resolved.fingerprintHash, original.fingerprintHash);
  assert.deepEqual(resolved.environment.fingerprint, original.fingerprint);
});

test("base headers use the account profile for authenticated upstream requests", () => {
  const profile = createSimulatedClientProfile({
    loginDeviceId: `B${"B".repeat(88)}`,
    clientDid: "123e4567-e89b-42d3-a456-426614174001",
    bundleId: "test.bundle",
    clientVersion: "9.9.9",
    locale: "en_US",
    platform: "web",
    timezoneOffset: "0",
    userAgent: "DeepSeek2API-Test/2.0",
    secChUa: '"Chromium";v="126"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Linux"'
  });
  const headers = createBaseHeaders("secret-token", { accept: "application/json" }, profile);

  assert.equal(headers.authorization, "Bearer secret-token");
  assert.equal(headers["user-agent"], profile.userAgent);
  assert.equal(headers["sec-ch-ua-platform"], profile.secChUaPlatform);
  assert.equal(headers["x-client-bundle-id"], profile.bundleId);
  assert.equal(headers["x-client-version"], profile.clientVersion);
  assert.equal(headers["x-client-locale"], profile.locale);
  assert.equal(headers.accept, "application/json");
});
