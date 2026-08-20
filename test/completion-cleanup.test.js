import assert from "node:assert/strict";
import test from "node:test";

import { config, resolveDeepseekApiPath } from "../src/config.js";
import { cleanupCompletedChatSession } from "../src/routes/proxy-routes.js";
import { streamDeepseekChatResponse } from "../src/services/deepseek-chat-response.js";
import { createSimulatedClientProfile } from "../src/services/deepseek-device.js";
import { collectCompletionContent } from "../src/services/openai-completion-runner.js";
import { streamOpenAiResponse } from "../src/services/openai-bridge.js";

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

function createAccount() {
  const deviceProfile = createSimulatedClientProfile({
    hostPlatform: "Windows",
    loginDeviceId: `B${"G".repeat(88)}`,
    clientDid: "123e4567-e89b-42d3-a456-426614174007"
  });
  return {
    id: "account-cleanup-fixture",
    token: "TOKEN",
    deviceProfile
  };
}

function createRequestOptions() {
  return {
    imageInputs: [],
    model: {
      modelType: "chat",
      searchEnabled: false,
      thinkingEnabled: false
    },
    prompt: "fixture prompt",
    refFileIds: []
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

function createOkPayload() {
  return {
    code: 0,
    data: {
      biz_code: 0,
      biz_msg: "",
      biz_data: {}
    }
  };
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
  constructor(events) {
    this.destroyed = false;
    this.headersSent = false;
    this.writableEnded = false;
    this.chunks = [];
    this.events = events;
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
    this.headersSent = true;
    this.events.push("headers");
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
    this.events.push("response-end");
    return this;
  }
}

test("incognito completion deletes the session only after a confirmed finish", async (t) => {
  disableCompletionPow(t);
  const originalFetch = globalThis.fetch;
  const paths = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options) => {
    const pathname = new URL(url).pathname;
    paths.push(pathname.replace(/^\/api\/v\d+/, ""));

    if (pathname.endsWith("/chat_session/create")) {
      return createJsonResponse(createSessionPayload("session-complete"));
    }
    if (pathname.endsWith("/chat/completion")) {
      return createSseResponse([
        "event: ready\n",
        "data: {\"response_message_id\":\"message-complete\"}\n\n",
        "data: {\"v\":{\"response\":{\"message_id\":\"message-complete\",",
        "\"status\":\"FINISHED\",\"fragments\":[",
        "{\"type\":\"ANSWER\",\"content\":\"done\"}]}}}\n\n",
        "event: finish\n\n",
        "event: close\n",
        "data: {\"click_behavior\":\"none\"}\n\n"
      ].join(""));
    }
    if (pathname.endsWith("/chat_session/delete")) {
      assert.deepEqual(JSON.parse(options.body.toString("utf8")), {
        chat_session_id: "session-complete"
      });
      return createJsonResponse(createOkPayload());
    }

    throw new Error(`Unexpected request: ${pathname}`);
  };

  const result = await collectCompletionContent({
    account: createAccount(),
    deleteAfterFinish: true,
    requestOptions: createRequestOptions()
  });

  assert.equal(result.completed, true);
  assert.equal(result.content, "done");
  assert.deepEqual(paths, [
    "/chat_session/create",
    "/chat/completion",
    "/chat_session/delete"
  ]);
});

test("incognito completion keeps the session when continuation fails", async (t) => {
  disableCompletionPow(t);
  const originalFetch = globalThis.fetch;
  const paths = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    const pathname = new URL(url).pathname;
    paths.push(pathname.replace(/^\/api\/v\d+/, ""));

    if (pathname.endsWith("/chat_session/create")) {
      return createJsonResponse(createSessionPayload("session-incomplete"));
    }
    if (pathname.endsWith("/chat/completion")) {
      return createSseResponse([
        "event: ready\n",
        "data: {\"response_message_id\":\"message-incomplete\"}\n\n",
        "data: {\"p\":\"response/status\",\"o\":\"SET\",\"v\":\"INCOMPLETE\"}\n\n",
        "event: close\n",
        "data: {\"click_behavior\":\"continue\"}\n\n"
      ].join(""));
    }
    if (pathname.endsWith("/chat/continue")) {
      return createSseResponse([
        "event: ready\n",
        "data: {\"response_message_id\":\"message-incomplete\"}\n\n",
        "event: toast\n",
        "data: {\"type\":\"error\",\"content\":\"Rate limit reached\",",
        "\"finish_reason\":\"rate_limit_reached\"}\n\n",
        "event: close\n",
        "data: {\"click_behavior\":\"none\"}\n\n"
      ].join(""));
    }

    throw new Error(`Unexpected request: ${pathname}`);
  };

  await assert.rejects(
    collectCompletionContent({
      account: createAccount(),
      deleteAfterFinish: true,
      requestOptions: createRequestOptions()
    }),
    (error) => error.statusCode === 429
  );

  assert.deepEqual(paths, [
    "/chat_session/create",
    "/chat/completion",
    "/chat/continue"
  ]);
  assert.equal(paths.includes("/chat_session/delete"), false);
});

test("proxy streaming cleanup runs after the logical resumed/continued stream ends", async (t) => {
  disableCompletionPow(t);
  const originalFetch = globalThis.fetch;
  const events = [];
  const paths = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    const pathname = new URL(url).pathname;
    paths.push(pathname.replace(/^\/api\/v\d+/, ""));

    if (pathname.endsWith("/chat/completion")) {
      return createSseResponse([
        "event: ready\n",
        "data: {\"response_message_id\":\"message-proxy\"}\n\n",
        "data: {\"p\":\"response\",\"o\":\"BATCH\",\"v\":[",
        "{\"p\":\"content\",\"o\":\"APPEND\",\"v\":\"first\"},",
        "{\"p\":\"status\",\"o\":\"SET\",\"v\":\"INCOMPLETE\"}]}\n\n",
        "event: close\n",
        "data: {\"click_behavior\":\"continue\"}\n\n"
      ].join(""));
    }
    if (pathname.endsWith("/chat/continue")) {
      return createSseResponse([
        "event: ready\n",
        "data: {\"response_message_id\":\"message-proxy\"}\n\n",
        "data: {\"v\":{\"response\":{\"message_id\":\"message-proxy\",",
        "\"status\":\"FINISHED\",\"fragments\":[",
        "{\"type\":\"ANSWER\",\"content\":\"first second\"}]}}}\n\n",
        "event: finish\n\n",
        "event: close\n",
        "data: {\"click_behavior\":\"none\"}\n\n"
      ].join(""));
    }

    throw new Error(`Unexpected request: ${pathname}`);
  };

  const response = new MemoryResponse(events);
  const account = createAccount();
  const completion = await streamDeepseekChatResponse({
    account,
    body: {
      chat_session_id: "session-proxy",
      model_type: "chat",
      prompt: "fixture",
      thinking_enabled: false,
      search_enabled: false
    },
    response
  });
  const deleteCalls = [];
  const cleaned = await cleanupCompletedChatSession({
    account,
    chatSessionId: "session-proxy",
    completion,
    deleteSession: async (selectedAccount, sessionId) => {
      events.push("delete");
      deleteCalls.push({ selectedAccount, sessionId });
    }
  });

  assert.equal(completion.completed, true);
  assert.equal(completion.result.content, "first second");
  assert.equal(cleaned, true);
  assert.deepEqual(paths, ["/chat/completion", "/chat/continue"]);
  assert.deepEqual(events, ["headers", "response-end", "delete"]);
  assert.equal(deleteCalls[0].sessionId, "session-proxy");
  assert.equal(deleteCalls[0].selectedAccount, completion.refreshedAccount);
  assert.match(response.chunks.join(""), /first second|first.* second/s);
});

test("proxy cleanup helper ignores incomplete logical streams", async () => {
  let deleteCount = 0;
  const cleaned = await cleanupCompletedChatSession({
    account: createAccount(),
    chatSessionId: "session-kept",
    completion: { completed: false },
    deleteSession: async () => {
      deleteCount += 1;
    }
  });

  assert.equal(cleaned, false);
  assert.equal(deleteCount, 0);
});

test("OpenAI SSE ends cleanly when automatic continuation fails after headers", async (t) => {
  disableCompletionPow(t);
  const originalFetch = globalThis.fetch;
  const paths = [];
  const events = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    const pathname = new URL(url).pathname;
    paths.push(pathname.replace(/^\/api\/v\d+/, ""));

    if (pathname.endsWith("/chat_session/create")) {
      return createJsonResponse(createSessionPayload("session-openai-failure"));
    }
    if (pathname.endsWith("/chat/completion")) {
      return createSseResponse([
        "event: ready\n",
        "data: {\"response_message_id\":\"message-openai-failure\"}\n\n",
        "data: {\"p\":\"response/status\",\"o\":\"SET\",\"v\":\"INCOMPLETE\"}\n\n",
        "event: close\n",
        "data: {\"click_behavior\":\"continue\"}\n\n"
      ].join(""));
    }
    if (pathname.endsWith("/chat/continue")) {
      return createSseResponse([
        "event: toast\n",
        "data: {\"type\":\"error\",\"content\":\"Rate limit reached\",",
        "\"finish_reason\":\"rate_limit_reached\"}\n\n",
        "event: close\n",
        "data: {\"click_behavior\":\"none\"}\n\n"
      ].join(""));
    }

    throw new Error(`Unexpected request: ${pathname}`);
  };

  const response = new MemoryResponse(events);
  await assert.rejects(
    streamOpenAiResponse({
      account: createAccount(),
      body: {
        messages: [{ content: "fixture", role: "user" }],
        model: "deepseek-chat",
        stream: true
      },
      deleteAfterFinish: true,
      ownerId: "owner-fixture",
      response
    }),
    (error) => error.statusCode === 429
  );

  assert.equal(response.writableEnded, true);
  assert.match(response.chunks.join(""), /upstream_error/);
  assert.match(response.chunks.join(""), /\[DONE\]/);
  assert.equal(paths.includes("/chat_session/delete"), false);
});
