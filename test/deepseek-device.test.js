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
  assert.notEqual(first.clientDid, second.clientDid);
  assert.equal(first.profileVersion, 3);
  assert.equal(first.fingerprint.platform, first.hostPlatform);
  assert.equal(first.environment.hostPlatform, first.hostPlatform);
  assert.equal(first.environment.fingerprint, first.fingerprint);
  assert.equal(first.secChUaPlatform, `"${first.hostPlatform}"`);
  assert.match(first.secChUa, /"Chromium";v="\d+", "Google Chrome";v="\d+"/);
  assert.match(first.acceptLanguage, /^[a-z]{2}(?:-[A-Z]{2})?/);
  assert.match(first.fingerprintHash, /^[0-9a-f]{64}$/i);
  assert.equal(first.environment.fingerprintHash, undefined);
});

test("platform personas keep user agent, client hints and fingerprint coherent", () => {
  const fixtures = [
    { platform: "Windows", marker: /\(Windows NT 10\.0; Win64; x64\)/ },
    { platform: "macOS", marker: /\(Macintosh; Intel Mac OS X 10_15_7\)/ },
    { platform: "Linux", marker: /\(X11; Linux x86_64\)/ }
  ];

  fixtures.forEach(({ platform, marker }, index) => {
    const profile = createSimulatedClientProfile({
      hostPlatform: platform,
      loginDeviceId: `B${String.fromCharCode(67 + index).repeat(88)}`,
      clientDid: `123e4567-e89b-42d3-a456-42661417400${2 + index}`
    });

    assert.match(profile.userAgent, marker);
    assert.equal(profile.hostPlatform, platform);
    assert.equal(profile.fingerprint.platform, platform);
    assert.equal(profile.environment.hostPlatform, platform);
    assert.equal(profile.secChUaPlatform, `"${platform}"`);
  });
});

test("legacy mismatched environment fields are healed without rotating identifiers", () => {
  const loginDeviceId = `B${"F".repeat(88)}`;
  const clientDid = "123e4567-e89b-42d3-a456-426614174006";
  const resolved = resolveDeepseekClientProfile({
    deviceProfile: {
      loginDeviceId,
      clientDid,
      hostPlatform: "Linux",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36",
      secChUaPlatform: '"macOS"',
      fingerprint: {
        platform: "macOS",
        screenWidth: 1440,
        screenHeight: 900,
        webglVendor: "Mesa",
        webglRenderer: "Mesa DRI Graphics"
      },
      fingerprintHash: "stale-hash",
      environment: {
        hostPlatform: "macOS",
        fingerprint: { platform: "macOS" }
      }
    }
  });

  assert.equal(resolved.loginDeviceId, loginDeviceId);
  assert.equal(resolved.clientDid, clientDid);
  assert.equal(resolved.hostPlatform, "Linux");
  assert.equal(resolved.fingerprint.platform, "Linux");
  assert.equal(resolved.environment.hostPlatform, "Linux");
  assert.equal(resolved.environment.fingerprint, resolved.fingerprint);
  assert.equal(resolved.secChUaPlatform, '"Linux"');
  assert.match(resolved.fingerprintHash, /^[0-9a-f]{64}$/i);
  assert.notEqual(resolved.fingerprintHash, "stale-hash");
});

test("a legacy device-only profile derives a stable client DID", () => {
  const deviceId = `B${"H".repeat(88)}`;
  const first = resolveDeepseekClientProfile({ deviceId });
  const second = resolveDeepseekClientProfile({ deviceId });

  assert.equal(first.loginDeviceId, deviceId);
  assert.equal(first.clientDid, second.clientDid);
  assert.match(first.clientDid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
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
  assert.equal(headers["accept-language"], profile.acceptLanguage);
  assert.equal(headers["x-client-did"], undefined);
  assert.equal(headers["x-device-id"], undefined);
  assert.equal(headers["x-client-source"], undefined);
});
