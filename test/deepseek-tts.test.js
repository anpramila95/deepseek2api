import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { synthesizeSpeech, resolveAudioContentType, getAccountCachedVoice } from "../src/services/deepseek-tts-service.js";
import { config } from "../src/config.js";

test("resolveAudioContentType maps formats to expected Content-Type", () => {
  assert.equal(resolveAudioContentType("opus"), "audio/ogg");
  assert.equal(resolveAudioContentType("mp3"), "audio/mpeg");
  assert.equal(resolveAudioContentType("wav"), "audio/wav");
  assert.equal(resolveAudioContentType("aac"), "audio/aac");
  assert.equal(resolveAudioContentType("flac"), "audio/flac");
  assert.equal(resolveAudioContentType("unknown"), "audio/ogg");
});

function createWsFrame(data, isBinary = false) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  const length = payload.length;
  let header;

  const opcode = isBinary ? 0x02 : 0x01;
  const firstByte = 0x80 | opcode;

  if (length < 126) {
    header = Buffer.from([firstByte, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = firstByte;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = firstByte;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

function createCloseFrame() {
  return Buffer.from([0x88, 0x00]);
}

test("synthesizeSpeech completes full TTS flow, sets voice, and deletes session", async () => {
  const originalBaseUrl = config.deepseekBaseUrl;
  const voicesFile = join(process.cwd(), "data", "account-voices.json");
  try { rmSync(voicesFile, { force: true }); } catch {}

  const deletedSessionIds = [];
  const createdSessions = [];
  let voiceSetCalled = false;
  let voiceSetBody = null;
  let ticketRequested = false;
  let wsUrlReceived = "";

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");

    if (url.pathname.includes("/chat/tts/voice")) {
      voiceSetCalled = true;
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try { voiceSetBody = JSON.parse(body); } catch {}
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          code: 0,
          msg: "",
          data: { biz_code: 0, biz_msg: "", biz_data: {} }
        }));
      });
      return;
    }

    if (url.pathname.includes("/chat_session/create")) {
      const sessionId = "mock-session-123";
      createdSessions.push(sessionId);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        code: 0,
        msg: "",
        data: {
          biz_code: 0,
          biz_msg: "",
          biz_data: {
            chat_session: { id: sessionId }
          }
        }
      }));
      return;
    }

    if (url.pathname.includes("/chat/completion")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ v: { response: { message_id: 2, role: "ASSISTANT" } } })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Xin chào, thế giới." } }] })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
      return;
    }

    if (url.pathname.includes("/auth/ticket")) {
      ticketRequested = true;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        code: 0,
        msg: "",
        data: {
          biz_code: 0,
          biz_msg: "",
          biz_data: {
            ticket: "mock-ticket-456",
            expires_in_secs: 600
          }
        }
      }));
      return;
    }

    if (url.pathname.includes("/chat_session/delete")) {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          deletedSessionIds.push(...(parsed.chat_session_ids ?? []));
        } catch {}
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          code: 0,
          msg: "",
          data: { biz_code: 0, biz_msg: "", biz_data: {} }
        }));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.on("upgrade", (req, socket) => {
    wsUrlReceived = req.url;
    const key = req.headers["sec-websocket-key"];
    const acceptKey = createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");

    const responseHeaders = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "\r\n"
    ];

    socket.write(responseHeaders.join("\r\n"));

    const readyJson = JSON.stringify({
      event: "ready",
      audio_id: "mock-audio-id",
      format: "opus",
      voice_id: "mira"
    });
    socket.write(createWsFrame(readyJson, false));

    socket.write(createWsFrame(Buffer.from([0x4f, 0x67, 0x67, 0x53]), true));
    socket.write(createWsFrame(Buffer.from([0x01, 0x02, 0x03, 0x04]), true));

    setTimeout(() => {
      socket.write(createCloseFrame());
      socket.end();
    }, 50);
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const mockBaseUrl = `http://127.0.0.1:${port}`;

  Object.defineProperty(config, "deepseekBaseUrl", {
    value: mockBaseUrl,
    configurable: true,
    writable: true
  });

  const account = {
    id: "acc-1",
    token: "mock-token",
    loginValue: "test@example.com",
    profile: {}
  };

  try {
    const result = await synthesizeSpeech({
      account,
      prompt: "Xin chào thế giới",
      voice: "mira",
      format: "opus"
    });

    assert.ok(voiceSetCalled, "Voice POST was called");
    assert.deepEqual(voiceSetBody, { voice_id: "mira" }, "Voice body matches target voice");
    assert.equal(getAccountCachedVoice("acc-1"), "mira", "Account voice was cached");
    assert.ok(ticketRequested, "TTS ticket was requested");
    assert.equal(createdSessions.length, 1, "One chat session was created");
    assert.deepEqual(deletedSessionIds, ["mock-session-123"], "Chat session was deleted after completion");
    assert.ok(result.audioBuffer instanceof Buffer, "Returns audio buffer");
    assert.equal(result.audioBuffer.length, 8, "Assembled audio buffer has full binary data");
    assert.ok(wsUrlReceived.includes("chat_session_id=mock-session-123"), "WebSocket URL includes chat_session_id");
    assert.ok(wsUrlReceived.includes("message_id=2"), "WebSocket URL includes message_id 2");
    assert.ok(wsUrlReceived.includes("ticket=mock-ticket-456"), "WebSocket URL includes ticket");
    assert.ok(wsUrlReceived.includes("voice_id=mira"), "WebSocket URL includes voice_id");
  } finally {
    Object.defineProperty(config, "deepseekBaseUrl", {
      value: originalBaseUrl,
      configurable: true,
      writable: true
    });
    server.close();
    try { rmSync(voicesFile, { force: true }); } catch {}
  }
});
