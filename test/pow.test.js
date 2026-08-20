import assert from "node:assert/strict";
import test from "node:test";

import {
  getPowChallengeExpireAtMs,
  isInvalidPowResponseText,
  isPowChallengeFresh,
  resolvePowExpireAtMs
} from "../src/services/pow-utils.js";

test("PoW expiry accepts the current millisecond timestamp format", () => {
  const now = 1_786_973_300_000;
  const challenge = { expire_at: now + 300_000 };

  assert.equal(getPowChallengeExpireAtMs(challenge), now + 300_000);
  assert.equal(isPowChallengeFresh(challenge, now), true);
  assert.equal(isPowChallengeFresh(challenge, now + 271_000), false);
  assert.equal(isPowChallengeFresh(challenge, now + 300_001), false);
});

test("PoW expiry remains compatible with second-based fixtures", () => {
  const nowSeconds = 1_786_973_300;
  const expirySeconds = nowSeconds + 300;

  assert.equal(resolvePowExpireAtMs(expirySeconds), expirySeconds * 1_000);
  assert.equal(isPowChallengeFresh({ expireAt: expirySeconds }, nowSeconds * 1_000), true);
  assert.equal(getPowChallengeExpireAtMs({ expireAt: expirySeconds }), expirySeconds * 1_000);
});

test("expired PoW challenges are rejected even when their millisecond value is compared to seconds", () => {
  const now = 1_786_973_300_000;
  const expired = { expire_at: now - 1_000 };

  assert.equal(isPowChallengeFresh(expired, now), false);
});

test("only the explicit upstream invalid-PoW marker is detected", () => {
  assert.equal(isInvalidPowResponseText("INVALID_POW_RESPONSE"), true);
  assert.equal(isInvalidPowResponseText('{"msg":"INVALID_POW_RESPONSE"}'), true);
  assert.equal(isInvalidPowResponseText("invalid pow response"), false);
  assert.equal(isInvalidPowResponseText("challenge required"), false);
  assert.equal(isInvalidPowResponseText(""), false);
});
