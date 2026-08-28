import assert from "node:assert/strict";
import test from "node:test";
import { parseToolCallsFromText } from "../src/services/openai-tool-parser.js";

test("parseToolCallsFromText converts <execute_code> tags into code_interpreter tool calls", () => {
  const text = [
    "Tôi sẽ chạy đoạn mã sau:",
    "<execute_code>",
    "```python",
    "import os",
    "print('hello world')",
    "```",
    "</execute_code>"
  ].join("\n");

  const calls = parseToolCallsFromText(text);
  assert.ok(calls.length >= 1);
  const codeCall = calls.find((c) => c.name === "code_interpreter");
  assert.ok(codeCall);
  assert.equal(codeCall.input.code, "import os\nprint('hello world')");
});
