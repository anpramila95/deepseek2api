import assert from "node:assert/strict";
import test from "node:test";
import { loginToDeepseek } from "../src/services/deepseek-auth.js";

test("loginToDeepseek throws descriptive safe upstream error on HTTP 202 CloudFront WAF challenge", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response("", {
      status: 202,
      statusText: "Accepted",
      headers: {
        "content-type": "text/html; charset=UTF-8",
        "x-amzn-waf-action": "challenge"
      }
    });
  };

  try {
    await assert.rejects(
      async () => {
        await loginToDeepseek({ loginValue: "user@example.com", password: "password" });
      },
      (err) => {
        assert.ok(err.message.includes("CloudFront / AWS WAF challenge encountered"), err.message);
        assert.ok(err.message.includes("HTTP 202"), err.message);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loginToDeepseek returns parsed biz_data on success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        code: 0,
        data: {
          biz_code: 0,
          biz_data: { user: { id: "user-123", token: "test-token" } }
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const result = await loginToDeepseek({ loginValue: "user@example.com", password: "password" });
    assert.equal(result.data.biz_code, 0);
    assert.equal(result.data.biz_data.user.id, "user-123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
