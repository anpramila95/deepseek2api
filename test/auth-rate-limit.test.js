import assert from "node:assert/strict";
import test from "node:test";
import { checkAuthRateLimit, recordFailedAuth, resetAuthRateLimit } from "../src/services/auth-rate-limit-service.js";

test("checkAuthRateLimit allows requests initially", () => {
  const ip = "192.168.1.100";
  resetAuthRateLimit(ip);
  const status = checkAuthRateLimit(ip);
  assert.equal(status.allowed, true);
});

test("checkAuthRateLimit blocks after 5 failed attempts within window", () => {
  const ip = "192.168.1.101";
  resetAuthRateLimit(ip);

  for (let i = 0; i < 5; i++) {
    assert.equal(checkAuthRateLimit(ip).allowed, true);
    recordFailedAuth(ip);
  }

  const blocked = checkAuthRateLimit(ip);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test("resetAuthRateLimit unblocks IP", () => {
  const ip = "192.168.1.102";
  for (let i = 0; i < 5; i++) {
    recordFailedAuth(ip);
  }
  assert.equal(checkAuthRateLimit(ip).allowed, false);

  resetAuthRateLimit(ip);
  assert.equal(checkAuthRateLimit(ip).allowed, true);
});
