import assert from "node:assert/strict";
import test from "node:test";
import { parseImportText, parseImportItems } from "../src/services/account-import-service.js";

test("parseImportText parses comma-separated lines", () => {
  const text = [
    "user1@gmail.com,pass123,http://proxy1:8080",
    "user2@gmail.com,pass456",
    "user3@gmail.com,pass789,socks5://127.0.0.1:1080"
  ].join("\n");

  const items = parseImportText(text);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    email: "user1@gmail.com",
    password: "pass123",
    proxy: "http://proxy1:8080"
  });
  assert.deepEqual(items[1], {
    email: "user2@gmail.com",
    password: "pass456"
  });
  assert.deepEqual(items[2], {
    email: "user3@gmail.com",
    password: "pass789",
    proxy: "socks5://127.0.0.1:1080"
  });
});

test("parseImportText parses 4-dash and pipe separated lines", () => {
  const text = [
    "user1@gmail.com----pass123----http://proxy1:8080",
    "user2@gmail.com|pass456|http://proxy2:8080"
  ].join("\n");

  const items = parseImportText(text);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    email: "user1@gmail.com",
    password: "pass123",
    proxy: "http://proxy1:8080"
  });
  assert.deepEqual(items[1], {
    email: "user2@gmail.com",
    password: "pass456",
    proxy: "http://proxy2:8080"
  });
});

test("parseImportText parses JSON array format", () => {
  const json = JSON.stringify([
    { email: "user1@gmail.com", password: "pass1", proxy: "http://p1" },
    { email: "user2@gmail.com", password: "pass2", proxy: "http://p2" }
  ]);

  const items = parseImportText(json);
  assert.equal(items.length, 2);
  assert.equal(items[0].email, "user1@gmail.com");
  assert.equal(items[1].proxy, "http://p2");
});

test("parseImportItems accepts array and text inputs", () => {
  assert.equal(parseImportItems("").length, 0);
  assert.equal(parseImportItems([{ email: "a@b.com" }]).length, 1);
  assert.equal(parseImportItems({ accounts: [{ email: "a@b.com" }] }).length, 1);
});
