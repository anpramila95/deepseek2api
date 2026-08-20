import assert from "node:assert/strict";
import test from "node:test";

import { config, resolveDeepseekApiPath } from "../src/config.js";
import { createSimulatedClientProfile } from "../src/services/deepseek-device.js";
import { streamOpenAiResponse } from "../src/services/openai-bridge.js";

const FREQUENCY_MESSAGE = "消息发送过于频繁，请稍后重试";

function createJsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status: 200
  });
}

function createSseResponse(body) {
  return new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
    status: 200
  });
}

function createAccount(id, token, deviceSuffix) {
  return {
    id,
    token,
    deviceProfile: createSimulatedClientProfile({
      hostPlatform: "Windows",
      loginDeviceId: `B${deviceSuffix.repeat(88)}`,
      clientDid: `123e4567-e89b-42d3-a456-42661417400${deviceSuffix}`
    })
  };
}

function createSessionPayload(sessionId) {
  return {
    code: 0,
    data: {
      biz_code: 0,
      biz_msg: "",
      biz_data: {
        chat_session: { id: sessionId }
      }
    }
  };
}

function createFrequencyStream() {
  return createSseResponse([
    "event: toast\n",
    `data: ${JSON.stringify({
      type: "error",
      content: FREQUENCY_MESSAGE,
      finish_reason: "rate_limit_reached"
    })}\n\n`,
    "event: close\n",
    "data: {\"click_behavior\":\"none\"}\n\n"
  ].join(""));
}

function createSuccessStream() {
  return createSseResponse([
    "event: ready\n",
    "data: {\"response_message_id\":\"message-success\"}\n\n",
    "data: {\"v\":{\"response\":{\"message_id\":\"message-success\",",
    "\"status\":\"FINISHED\",\"fragments\":[",
    "{\"type\":\"ANSWER\",\"content\":\"retry succeeded\"}]}}}\n\n",
    "event: finish\n\n",
    "event: close\n",
    "data: {\"click_behavior\":\"none\"}\n\n"
  ].join(""));
}

function disableCompletionPow(t) {
  const path = resolveDeepseekApiPath("/chat/completion");
  const wasProtected = config.powProtectedPaths.has(path);
  config.powProtectedPaths.delete(path);
  t.after(() => {
    if (wasProtected) {
      config.powProtectedPaths.add(path);
    }
  });
}

class MemoryResponse {
  constructor() {
    this.destroyed = false;
    this.headersSent = false;
    this.writableEnded = false;
    this.chunks = [];
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
    this.headersSent = true;
    return this;
  }

  flushHeaders() {}

  write(chunk) {
    this.chunks.push(String(chunk));
    return true;
  }

  end(chunk = "") {
    if (chunk) {
      this.chunks.push(String(chunk));
    }
    this.writableEnded = true;
    return this;
  }
}

test("OpenAI SSE keeps heartbeating and rotates accounts across three frequency retries", async (t) => {
  disableCompletionPow(t);
  const originalFetch = globalThis.fetch;
  const accounts = [
    createAccount("account-a", "TOKEN_A", "1"),
    createAccount("account-b", "TOKEN_B", "2")
  ];
  const completionTokens = [];
  const retryNumbers = [];
  let sessionCount = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/chat_session/create")) {
      sessionCount += 1;
      return createJsonResponse(createSessionPayload(`session-${sessionCount}`));
    }
    if (pathname.endsWith("/chat/completion")) {
      completionTokens.push(options.headers.authorization);
      return completionTokens.length <= 3 ? createFrequencyStream() : createSuccessStream();
    }

    throw new Error(`Unexpected request: ${pathname}`);
  };

  const response = new MemoryResponse();
  await streamOpenAiResponse({
    account: accounts[0],
    body: {
      messages: [{ content: "fixture", role: "user" }],
      model: "deepseek-chat",
      stream: true
    },
    heartbeatIntervalMs: 5,
    onFrequencyRetry: ({ retryCount }) => retryNumbers.push(retryCount),
    ownerId: "owner-fixture",
    response,
    retryDelayMs: 15,
    selectNextAccount: (currentAccount) => (
      currentAccount.id === accounts[0].id ? accounts[1] : accounts[0]
    )
  });

  const output = response.chunks.join("");
  const heartbeatCount = response.chunks.filter((chunk) => chunk === ": keep-alive\n\n").length;
  assert.deepEqual(completionTokens, [
    "Bearer TOKEN_A",
    "Bearer TOKEN_B",
    "Bearer TOKEN_A",
    "Bearer TOKEN_B"
  ]);
  assert.deepEqual(retryNumbers, [1, 2, 3]);
  assert.equal(sessionCount, 4);
  assert.ok(heartbeatCount >= 3, `expected at least 3 heartbeats, received ${heartbeatCount}`);
  assert.match(output, /retry succeeded/);
  assert.doesNotMatch(output, /upstream_error/);
  assert.match(output, /data: \[DONE\]/);
  assert.equal(response.writableEnded, true);
});
