import assert from "node:assert/strict";
import test from "node:test";

import { maskIdentifier, redactSensitiveText } from "../src/utils/privacy.js";

test("identifier masking is idempotent", () => {
  const email = maskIdentifier("someone@example.com");
  const phone = maskIdentifier("13800138000");

  assert.equal(email, "so***@example.com");
  assert.equal(maskIdentifier(email), email);
  assert.equal(phone, "138****8000");
  assert.equal(maskIdentifier(phone), phone);
});

test("sensitive error details are redacted before logging or responding", () => {
  const value = redactSensitiveText(
    'authorization: Bearer abc.def password="hunter2" email=someone@example.com mobile=13800138000'
  );

  assert.doesNotMatch(value, /abc\.def|hunter2|someone@example\.com|13800138000/);
  assert.match(value, /\[REDACTED\]/);
  assert.match(value, /so\*\*\*@example\.com/);
  assert.match(value, /138\*\*\*\*8000/);
});
