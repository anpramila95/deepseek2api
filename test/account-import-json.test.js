import assert from "node:assert/strict";
import test from "node:test";
import { importRawDeepseekAccountForOwner } from "../src/services/account-import-service.js";

test("importRawDeepseekAccountForOwner rejects invalid empty input", async () => {
  await assert.rejects(
    async () => {
      await importRawDeepseekAccountForOwner({ ownerId: "owner-1", rawInput: "" });
    },
    (err) => {
      assert.match(err.message, /Không tìm thấy dữ liệu/i);
      return true;
    }
  );
});

test("importRawDeepseekAccountForOwner imports valid raw JSON object with token", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        code: 0,
        data: {
          biz_code: 0,
          biz_data: { user: { id: "ds-user-999", email: "jsonuser@example.com" } }
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const rawJson = JSON.stringify({
      token: "test-token-123456",
      loginValue: "jsonuser@example.com"
    });

    const account = await importRawDeepseekAccountForOwner({
      ownerId: "owner-test",
      rawInput: rawJson
    });

    assert.equal(account.ownerId, "owner-test");
    assert.equal(account.token, "test-token-123456");
    assert.equal(account.deepseekUserId, "ds-user-999");
    assert.equal(account.status, "online");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("importRawDeepseekAccountForOwner imports plain token string", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        code: 0,
        data: {
          biz_code: 0,
          biz_data: { user: { id: "ds-user-888", email: "tokenuser@example.com" } }
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const account = await importRawDeepseekAccountForOwner({
      ownerId: "owner-test",
      rawInput: "Bearer my-plain-bearer-token"
    });

    assert.equal(account.token, "my-plain-bearer-token");
    assert.equal(account.deepseekUserId, "ds-user-888");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
