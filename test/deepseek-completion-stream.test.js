import assert from "node:assert/strict";
import test from "node:test";

import { consumeDeepseekCompletion } from "../src/services/deepseek-completion-stream.js";
import { createDeepseekDeltaDecoder } from "../src/utils/deepseek-sse.js";

function createSseResponse(body) {
  return new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
    status: 200
  });
}

function createAccount() {
  return {
    id: "account-fixture",
    token: "TOKEN"
  };
}

test("delta decoder preserves mixed thinking and answer patches in a batch", () => {
  const decoder = createDeepseekDeltaDecoder();
  const deltas = decoder.consumeAll(JSON.stringify({
    p: "response",
    o: "BATCH",
    v: [
      {
        p: "fragments",
        o: "APPEND",
        v: [{ type: "THINKING", content: "reason" }]
      },
      { p: "content", o: "APPEND", v: "answer" }
    ]
  }));

  assert.deepEqual(deltas, [
    { kind: "thinking", text: "reason" },
    { kind: "response", text: "answer" }
  ]);
});

test("response snapshots combine same-kind fragments before replay de-duplication", () => {
  const decoder = createDeepseekDeltaDecoder();
  const deltas = decoder.consumeAll(JSON.stringify({
    v: {
      response: {
        fragments: [
          { type: "THINK", content: "part one " },
          { type: "THINKING", content: "part two" },
          { type: "ANSWER", content: "final" }
        ]
      }
    }
  }));

  assert.deepEqual(deltas, [
    { kind: "thinking", text: "part one part two", snapshot: true },
    { kind: "response", text: "final", snapshot: true }
  ]);
});

test("a stream without close resumes and does not duplicate replayed thinking", async (t) => {
  const originalFetch = globalThis.fetch;
  const resumeRequests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options) => {
    resumeRequests.push({
      body: JSON.parse(options.body.toString("utf8")),
      method: options.method,
      pathname: new URL(url).pathname
    });

    return createSseResponse([
      "data: {\"v\":{\"response\":{\"fragments\":[",
      "{\"type\":\"THINK\",\"content\":\"plan\"},",
      "{\"type\":\"ANSWER\",\"content\":\"final answer\"}],",
      "\"status\":\"FINISHED\"}}}\n\n",
      "event: close\n\n"
    ].join(""));
  };

  const initialResponse = createSseResponse([
    "event: ready\n",
    "data: {\"response_message_id\":\"message-1\"}\n\n",
    "data: {\"v\":{\"response\":{\"fragments\":[",
    "{\"type\":\"THINK\",\"content\":\"plan\"}]}}}\n\n"
  ].join(""));
  const emitted = [];
  const result = await consumeDeepseekCompletion({
    account: createAccount(),
    onDelta: (delta) => emitted.push(delta),
    response: initialResponse,
    resumeDelayMs: 0,
    sessionId: "session-1"
  });

  assert.equal(resumeRequests.length, 1);
  assert.deepEqual(resumeRequests[0].body, {
    chat_session_id: "session-1",
    message_id: "message-1"
  });
  assert.equal(resumeRequests[0].method, "POST");
  assert.match(resumeRequests[0].pathname, /\/chat\/resume_stream$/);
  assert.deepEqual(emitted, [
    { kind: "thinking", text: "plan" },
    { kind: "response", text: "final answer" }
  ]);
  assert.equal(result.reasoningContent, "plan");
  assert.equal(result.content, "final answer");
  assert.equal(result.responseMessageId, "message-1");
});

test("resume business code 22 fills the remaining reasoning and answer", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => new Response(JSON.stringify({
    code: 0,
    data: {
      biz_code: 22,
      biz_msg: "",
      biz_data: {
        message: {
          message_id: "message-22",
          fragments: [
            { type: "THINKING", content: "partial reasoning complete" },
            { type: "RESPONSE", content: "completed answer" }
          ]
        }
      }
    }
  }), {
    headers: { "content-type": "application/json" },
    status: 200
  });

  const initialResponse = createSseResponse([
    "event: ready\n",
    "data: {\"response_message_id\":\"message-22\"}\n\n",
    "data: {\"v\":{\"response\":{\"fragments\":[",
    "{\"type\":\"THINK\",\"content\":\"partial reasoning\"}]}}}\n\n"
  ].join(""));
  const result = await consumeDeepseekCompletion({
    account: createAccount(),
    response: initialResponse,
    resumeDelayMs: 0,
    sessionId: "session-22"
  });

  assert.equal(result.reasoningContent, "partial reasoning complete");
  assert.equal(result.content, "completed answer");
});

test("a status-less close without finish is verified through resume before completion", async (t) => {
  const originalFetch = globalThis.fetch;
  let resumeCount = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => {
    resumeCount += 1;
    return new Response(JSON.stringify({
      code: 0,
      data: {
        biz_code: 22,
        biz_msg: "",
        biz_data: {
          message: {
            message_id: "message-ambiguous-close",
            status: "FINISHED",
            fragments: [{ type: "ANSWER", content: "verified answer" }]
          }
        }
      }
    }), {
      headers: { "content-type": "application/json" },
      status: 200
    });
  };

  const initialResponse = createSseResponse([
    "event: ready\n",
    "data: {\"response_message_id\":\"message-ambiguous-close\"}\n\n",
    "data: {\"p\":\"response/content\",\"o\":\"APPEND\",\"v\":\"verified\"}\n\n",
    "event: close\n",
    "data: {\"click_behavior\":\"none\"}\n\n"
  ].join(""));
  const result = await consumeDeepseekCompletion({
    account: createAccount(),
    response: initialResponse,
    resumeDelayMs: 0,
    sessionId: "session-ambiguous-close"
  });

  assert.equal(resumeCount, 1);
  assert.equal(result.content, "verified answer");
  assert.equal(result.completed, true);
  assert.equal(result.resumeCount, 1);
});

test("an incomplete close automatically calls chat continue and de-duplicates the replay", async (t) => {
  const originalFetch = globalThis.fetch;
  const continueRequests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options) => {
    continueRequests.push({
      body: JSON.parse(options.body.toString("utf8")),
      pathname: new URL(url).pathname
    });

    return createSseResponse([
      "event: ready\n",
      "data: {\"response_message_id\":\"message-incomplete\"}\n\n",
      "data: {\"v\":{\"response\":{\"message_id\":\"message-incomplete\",",
      "\"status\":\"FINISHED\",\"fragments\":[{\"type\":\"ANSWER\",",
      "\"content\":\"first second\"}]}}}\n\n",
      "event: finish\n",
      "data: {}\n\n",
      "event: close\n",
      "data: {\"click_behavior\":\"none\"}\n\n"
    ].join(""));
  };

  const initialResponse = createSseResponse([
    "event: ready\n",
    "data: {\"response_message_id\":\"message-incomplete\"}\n\n",
    "data: {\"p\":\"response\",\"o\":\"BATCH\",\"v\":[",
    "{\"p\":\"fragments\",\"o\":\"APPEND\",\"v\":[",
    "{\"type\":\"ANSWER\",\"content\":\"first\"}]},",
    "{\"p\":\"status\",\"o\":\"SET\",\"v\":\"INCOMPLETE\"},",
    "{\"p\":\"quasi_status\",\"o\":\"SET\",\"v\":\"WIP\"}]}\n\n",
    "event: close\n",
    "data: {\"click_behavior\":\"continue\"}\n\n"
  ].join(""));
  const emitted = [];
  const result = await consumeDeepseekCompletion({
    account: createAccount(),
    continueDelayMs: 0,
    onDelta: (delta) => emitted.push(delta),
    response: initialResponse,
    sessionId: "session-incomplete"
  });

  assert.equal(continueRequests.length, 1);
  assert.match(continueRequests[0].pathname, /\/chat\/continue$/);
  assert.deepEqual(continueRequests[0].body, {
    chat_session_id: "session-incomplete",
    message_id: "message-incomplete",
    fallback_to_resume: true
  });
  assert.deepEqual(emitted, [
    { kind: "response", text: "first" },
    { kind: "response", text: " second" }
  ]);
  assert.equal(result.content, "first second");
  assert.equal(result.continueCount, 1);
  assert.equal(result.completed, true);
  assert.equal(result.status, "FINISHED");
});

test("a code 22 resume that is still incomplete falls through to chat continue", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options) => {
    const request = {
      body: JSON.parse(options.body.toString("utf8")),
      pathname: new URL(url).pathname
    };
    requests.push(request);

    if (request.pathname.endsWith("/chat/resume_stream")) {
      return new Response(JSON.stringify({
        code: 0,
        data: {
          biz_code: 22,
          biz_msg: "",
          biz_data: {
            message: {
              message_id: "message-code-22",
              status: "INCOMPLETE",
              fragments: [{ type: "ANSWER", content: "partial" }]
            }
          }
        }
      }), {
        headers: { "content-type": "application/json" },
        status: 200
      });
    }

    return createSseResponse([
      "event: ready\n",
      "data: {\"response_message_id\":\"message-code-22\"}\n\n",
      "data: {\"v\":{\"response\":{\"message_id\":\"message-code-22\",",
      "\"status\":\"FINISHED\",\"fragments\":[",
      "{\"type\":\"ANSWER\",\"content\":\"partial completed\"}]}}}\n\n",
      "event: finish\n\n",
      "event: close\n",
      "data: {\"click_behavior\":\"none\"}\n\n"
    ].join(""));
  };

  const initialResponse = createSseResponse([
    "event: ready\n",
    "data: {\"response_message_id\":\"message-code-22\"}\n\n",
    "data: {\"p\":\"response/content\",\"o\":\"APPEND\",\"v\":\"partial\"}\n\n"
  ].join(""));
  const result = await consumeDeepseekCompletion({
    account: createAccount(),
    continueDelayMs: 0,
    response: initialResponse,
    resumeDelayMs: 0,
    sessionId: "session-code-22"
  });

  assert.deepEqual(requests.map((request) => request.pathname.replace(/^\/api\/v\d+/, "")), [
    "/chat/resume_stream",
    "/chat/continue"
  ]);
  assert.equal(result.content, "partial completed");
  assert.equal(result.resumeCount, 1);
  assert.equal(result.continueCount, 1);
  assert.equal(result.completed, true);
});

test("a rate-limit toast from chat continue stops without an automatic retry loop", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => {
    requestCount += 1;
    return createSseResponse([
      "event: ready\n",
      "data: {\"response_message_id\":\"message-rate-limit\"}\n\n",
      "event: toast\n",
      "data: {\"type\":\"error\",\"content\":\"Rate limit reached\",",
      "\"finish_reason\":\"rate_limit_reached\"}\n\n",
      "event: close\n",
      "data: {\"click_behavior\":\"none\"}\n\n"
    ].join(""));
  };

  const initialResponse = createSseResponse([
    "event: ready\n",
    "data: {\"response_message_id\":\"message-rate-limit\"}\n\n",
    "data: {\"p\":\"response/status\",\"o\":\"SET\",\"v\":\"INCOMPLETE\"}\n\n",
    "event: close\n",
    "data: {\"click_behavior\":\"continue\"}\n\n"
  ].join(""));

  await assert.rejects(
    consumeDeepseekCompletion({
      account: createAccount(),
      continueDelayMs: 0,
      maxContinues: 10,
      response: initialResponse,
      sessionId: "session-rate-limit"
    }),
    (error) => {
      assert.equal(error.statusCode, 429);
      assert.match(error.message, /rate limit/i);
      return true;
    }
  );
  assert.equal(requestCount, 1);
});

test("an empty SSE response is reported as an upstream failure", async () => {
  await assert.rejects(
    consumeDeepseekCompletion({
      account: createAccount(),
      response: createSseResponse(""),
      resumeDelayMs: 0,
      sessionId: "session-empty"
    }),
    /without any SSE events/
  );
});

test("an exhausted transport interruption is surfaced as a 502 status error", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode([
        "event: ready\n",
        "data: {\"response_message_id\":\"message-transport\"}\n\n",
        "data: {\"p\":\"response/content\",\"o\":\"APPEND\",\"v\":\"partial\"}\n\n"
      ].join("")));
      controller.error(new Error("fixture transport failure"));
    }
  });
  const response = new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
    status: 200
  });

  await assert.rejects(
    consumeDeepseekCompletion({
      account: createAccount(),
      maxResumes: 0,
      response,
      sessionId: "session-transport"
    }),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /transport interrupted/i);
      return true;
    }
  );
});
