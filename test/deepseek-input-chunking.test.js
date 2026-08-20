import assert from "node:assert/strict";
import test from "node:test";

import { config, resolveDeepseekApiPath } from "../src/config.js";
import { createSimulatedClientProfile } from "../src/services/deepseek-device.js";
import { splitDeepseekPrompt } from "../src/services/deepseek-input-chunking.js";
import { collectCompletionContent } from "../src/services/openai-completion-runner.js";

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

function createOkPayload(data = {}) {
  return {
    code: 0,
    data: {
      biz_code: 0,
      biz_msg: "",
      biz_data: data
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

test("prompt splitting preserves surrogate pairs and always advances", () => {
  const chunks = splitDeepseekPrompt("A😀B", 1);

  assert.deepEqual(chunks, ["A", "😀", "B"]);
  assert.equal(chunks.join(""), "A😀B");
  assert.ok(chunks.every((chunk) => chunk.length > 0));
});

test("oversized incognito completion interrupts intermediate chunks and deletes once", async (t) => {
  disableCompletionPow(t);
  const originalFetch = globalThis.fetch;
  const requests = [];
  const encoder = new TextEncoder();
  let intermediateController = null;
  let intermediateMessageTimer = null;
  let messageFrameDelivered = false;
  t.after(() => {
    clearTimeout(intermediateMessageTimer);
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options = {}) => {
    const pathname = new URL(url).pathname.replace(/^\/api\/v\d+/, "");
    const body = options.body
      ? JSON.parse(Buffer.from(options.body).toString("utf8"))
      : null;
    requests.push({ body, pathname });

    if (pathname === "/chat_session/create") {
      return createJsonResponse(createOkPayload({
        chat_session: { id: "session-chunked" }
      }));
    }
    if (pathname === "/chat/completion" && body.prompt === "abc") {
      return new Response(new ReadableStream({
        start(controller) {
          intermediateController = controller;
          controller.enqueue(encoder.encode([
            "event: ready\n",
            "data: {\"request_message_id\":1,\"response_message_id\":2}\n\n"
          ].join("")));
          intermediateMessageTimer = setTimeout(() => {
            messageFrameDelivered = true;
            controller.enqueue(encoder.encode([
              "event: message\n",
              "data: {\"v\":{\"response\":{\"message_id\":2,",
              "\"status\":\"WIP\",\"fragments\":[]}}}\n\n"
            ].join("")));
          }, 20);
        },
        cancel() {
          clearTimeout(intermediateMessageTimer);
        }
      }), {
        headers: { "content-type": "text/event-stream; charset=utf-8" },
        status: 200
      });
    }
    if (pathname === "/chat/stop_stream") {
      assert.equal(messageFrameDelivered, true);
      clearTimeout(intermediateMessageTimer);
      intermediateController.enqueue(encoder.encode([
        "event: close\n",
        "data: {\"click_behavior\":\"none\"}\n\n"
      ].join("")));
      intermediateController.close();
      return createJsonResponse(createOkPayload());
    }
    if (pathname === "/chat/completion" && body.prompt === "def") {
      return createSseResponse([
        "event: ready\n",
        "data: {\"response_message_id\":\"message-final\"}\n\n",
        "data: {\"v\":{\"response\":{\"message_id\":\"message-final\",",
        "\"status\":\"FINISHED\",\"fragments\":[",
        "{\"type\":\"ANSWER\",\"content\":\"done\"}]}}}\n\n",
        "event: finish\n\n",
        "event: close\n",
        "data: {\"click_behavior\":\"none\"}\n\n"
      ].join(""));
    }
    if (pathname === "/chat_session/delete") {
      return createJsonResponse(createOkPayload());
    }

    throw new Error(`Unexpected request: ${pathname}`);
  };

  const deviceProfile = createSimulatedClientProfile({
    loginDeviceId: `B${"J".repeat(88)}`,
    clientDid: "123e4567-e89b-42d3-a456-426614174009"
  });
  const result = await collectCompletionContent({
    account: { id: "account-chunked", token: "TOKEN", deviceProfile },
    deleteAfterFinish: true,
    inputContentLimit: 3,
    requestOptions: {
      imageInputs: [],
      model: {
        modelType: "chat",
        searchEnabled: false,
        thinkingEnabled: false
      },
      prompt: "abcdef",
      refFileIds: ["attachment-final"]
    }
  });

  assert.equal(result.completed, true);
  assert.equal(result.content, "done");
  assert.deepEqual(requests.map((entry) => entry.pathname), [
    "/chat_session/create",
    "/chat/completion",
    "/chat/stop_stream",
    "/chat/completion",
    "/chat_session/delete"
  ]);

  const [, first, stop, final, deletion] = requests;
  assert.equal(first.body.parent_message_id, null);
  assert.equal(first.body.model_type, "chat");
  assert.deepEqual(first.body.ref_file_ids, []);
  assert.deepEqual(stop.body, {
    chat_session_id: "session-chunked",
    message_id: 2
  });
  assert.equal(final.body.parent_message_id, 2);
  assert.equal(final.body.model_type, null);
  assert.deepEqual(final.body.ref_file_ids, ["attachment-final"]);
  assert.deepEqual(deletion.body, { chat_session_id: "session-chunked" });
  assert.equal(
    requests.filter((entry) => entry.pathname === "/chat_session/delete").length,
    1
  );
});
