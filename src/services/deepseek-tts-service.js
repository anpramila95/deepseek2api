import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { WebSocket } from "undici";
import { config, resolveDeepseekApiPath } from "../config.js";
import { createChatSession, deleteChatSession } from "./chat-session-service.js";
import { collectDeepseekChatResponse } from "./deepseek-chat-response.js";
import { proxyDeepseekRequest } from "./deepseek-proxy.js";
import { resolveProxyDispatcher } from "./proxy-dispatcher.js";

const SYSTEM_PROMPT_PREFIX = `[SYSTEM]
Viết lại 100% nội dung người dùng nhập vào mà không bỏ sót bất kỳ từ nào, không được thêm bất kỳ từ mới nào, không thêm chú thích, không hỏi gì cả, chỉ thêm dấu câu (. ,) vào những chỗ thích hợp và xuống dòng nếu có:
[USER]
`;

const FORMAT_CONTENT_TYPES = Object.freeze({
  opus: "audio/ogg; codecs=opus",
  ogg: "audio/ogg; codecs=opus",
  mp3: "audio/mpeg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm"
});

const VOICES_FILE = join(process.cwd(), "data", "account-voices.json");

function readAccountVoices() {
  try {
    if (existsSync(VOICES_FILE)) {
      return JSON.parse(readFileSync(VOICES_FILE, "utf8")) ?? {};
    }
  } catch {
    // ignore read error
  }
  return {};
}

function writeAccountVoices(voices) {
  try {
    const dataDir = join(process.cwd(), "data");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(VOICES_FILE, JSON.stringify(voices, null, 2), "utf8");
  } catch {
    // ignore write error
  }
}

export function getAccountCachedVoice(accountId) {
  const voices = readAccountVoices();
  return voices[accountId] ?? null;
}

export function setAccountCachedVoice(accountId, voiceId) {
  const voices = readAccountVoices();
  voices[accountId] = voiceId;
  writeAccountVoices(voices);
}

export async function ensureAccountVoice(account, targetVoice) {
  if (!targetVoice || !account) {
    return account;
  }

  const accountKey = account.id || account.deepseekUserId || account.loginValue;
  if (!accountKey) {
    return account;
  }

  const currentVoice = getAccountCachedVoice(accountKey);
  if (currentVoice === targetVoice) {
    console.log(`[TTS] Account ${accountKey} already using voice: ${targetVoice} (cached)`);
    return account;
  }

  console.log(`[TTS] Setting voice for account ${accountKey} -> ${targetVoice}...`);
  const { refreshedAccount, response } = await proxyDeepseekRequest({
    account,
    method: "POST",
    path: "/chat/tts/voice",
    body: Buffer.from(JSON.stringify({ voice_id: targetVoice })),
    headers: { "content-type": "application/json" }
  });

  const payload = await response.json().catch(() => null);
  const bizCode = payload?.data?.biz_code ?? payload?.code;
  if (response.ok && (bizCode === 0 || bizCode === undefined)) {
    console.log(`[TTS] Voice set successfully to ${targetVoice}`);
    setAccountCachedVoice(accountKey, targetVoice);
  } else {
    console.warn(`[TTS] Voice update returned non-zero biz_code:`, payload);
  }

  return refreshedAccount ?? account;
}

export function resolveAudioContentType(format) {
  return FORMAT_CONTENT_TYPES[String(format).toLowerCase()] || "audio/opus";
}

function downloadTtsAudio({ url, proxy, timeoutMs = 60000, idleTimeoutMs = 2000 }) {
  return new Promise((resolve, reject) => {
    let ws;
    let globalTimer;
    let idleTimer;
    const chunks = [];
    let isResolved = false;
    let totalBytes = 0;

    const cleanup = () => {
      clearTimeout(globalTimer);
      clearTimeout(idleTimer);
      if (ws) {
        try {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        } catch {
          // ignore cleanup errors
        }
      }
    };

    const finish = (reason = "completed") => {
      if (isResolved) return;
      isResolved = true;
      cleanup();
      if (chunks.length > 0) {
        console.log(`[TTS] WebSocket finished (${reason}). Total audio chunks: ${chunks.length}, bytes: ${totalBytes}`);
        resolve(Buffer.concat(chunks));
      } else {
        console.warn(`[TTS] WebSocket closed without audio chunks (${reason})`);
        reject(new Error("DeepSeek TTS WebSocket closed without returning audio data"));
      }
    };

    globalTimer = setTimeout(() => {
      if (chunks.length > 0) {
        finish("timeout-with-data");
      } else {
        cleanup();
        reject(new Error("DeepSeek TTS WebSocket timed out"));
      }
    }, timeoutMs);

    try {
      const options = {};
      const dispatcher = resolveProxyDispatcher(proxy);
      if (dispatcher) {
        options.dispatcher = dispatcher;
      }
      console.log(`[TTS] Connecting WebSocket: ${url}`);
      ws = new WebSocket(url, options);
      ws.binaryType = "arraybuffer";
    } catch (initError) {
      cleanup();
      reject(initError);
      return;
    }

    ws.onopen = () => {
      console.log(`[TTS] WebSocket connection opened`);
    };

    function handleJsonEvent(parsed, raw) {
      console.log(`[TTS] WebSocket event received:`, raw || JSON.stringify(parsed));
      if (
        parsed?.event === "finish" ||
        parsed?.event === "close" ||
        parsed?.event === "done" ||
        parsed?.event === "stop" ||
        parsed?.is_final === true
      ) {
        finish("event-" + (parsed.event || "finish"));
        return true;
      }
      if (parsed?.code && parsed.code !== 0) {
        cleanup();
        reject(new Error(parsed.msg || `TTS WebSocket error code ${parsed.code}`));
        return true;
      }
      if (parsed?.data?.biz_code && parsed.data.biz_code !== 0) {
        cleanup();
        reject(new Error(parsed.data.biz_msg || `TTS WebSocket biz error ${parsed.data.biz_code}`));
        return true;
      }
      return false;
    }

    ws.onmessage = async (event) => {
      try {
        const data = event.data;

        // 1. Text/JSON frames are events only
        if (typeof data === "string") {
          try {
            const parsed = JSON.parse(data);
            handleJsonEvent(parsed, data);
          } catch {
            console.log(`[TTS] WebSocket non-JSON text frame:`, data);
          }
          return;
        }

        // 2. Binary frames
        let buf = null;
        if (data instanceof ArrayBuffer) {
          buf = Buffer.from(data);
        } else if (Buffer.isBuffer(data)) {
          buf = data;
        } else if (ArrayBuffer.isView(data)) {
          buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        } else if (data && typeof data.arrayBuffer === "function") {
          const ab = await data.arrayBuffer();
          buf = Buffer.from(ab);
        }

        if (!buf || buf.length === 0) {
          return;
        }

        // Check if binary frame is accidentally a JSON event
        if (buf[0] === 0x7b && buf[buf.length - 1] === 0x7d) {
          try {
            const parsed = JSON.parse(buf.toString("utf8"));
            if (handleJsonEvent(parsed, buf.toString("utf8"))) {
              return;
            }
            if (parsed.event) {
              return;
            }
          } catch {
            // Not JSON, continue as audio
          }
        }

        totalBytes += buf.length;
        chunks.push(buf);

        // Reset idle timer after each binary audio chunk
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          finish("idle-timer");
        }, idleTimeoutMs);
      } catch (msgError) {
        cleanup();
        reject(msgError);
      }
    };

    ws.onerror = (event) => {
      const errorMsg = event?.message || event?.error?.message || "WebSocket error occurred";
      console.warn(`[TTS] WebSocket error: ${errorMsg}`);
      if (chunks.length > 0) {
        finish("error-with-data");
        return;
      }
      cleanup();
      reject(new Error(`DeepSeek TTS WebSocket error: ${errorMsg}`));
    };

    ws.onclose = (event) => {
      console.log(`[TTS] WebSocket connection closed (code: ${event?.code}, reason: ${event?.reason})`);
      finish("onclose");
    };
  });
}

async function fetchTtsTicket(account) {
  console.log(`[TTS] Requesting TTS ticket from /api/v0/auth/ticket...`);
  const { refreshedAccount, response } = await proxyDeepseekRequest({
    account,
    method: "POST",
    path: "/auth/ticket",
    body: Buffer.from(JSON.stringify({ scope: "tts" })),
    headers: { "content-type": "application/json" }
  });

  const ticketPayload = await response.json().catch(() => null);
  const ticket = ticketPayload?.data?.biz_data?.ticket;
  if (ticketPayload?.data?.biz_code !== 0 || !ticket) {
    console.warn(`[TTS] Failed to get ticket:`, ticketPayload);
    throw new Error(
      ticketPayload?.data?.biz_msg ||
        ticketPayload?.msg ||
        "Failed to acquire DeepSeek TTS ticket"
    );
  }

  console.log(`[TTS] Ticket acquired successfully: ${ticket}`);
  return { refreshedAccount: refreshedAccount ?? account, ticket };
}

async function downloadAudioWithRetry({ account, sessionId, messageId, format, maxRetries = 3 }) {
  let currentAccount = account;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[TTS] Downloading audio (attempt ${attempt}/${maxRetries})...`);
      const { refreshedAccount, ticket } = await fetchTtsTicket(currentAccount);
      currentAccount = refreshedAccount;

      const wsBaseUrl = config.deepseekBaseUrl
        .replace(/^http:/i, "ws:")
        .replace(/^https:/i, "wss:");
      const ttsUrl = new URL(resolveDeepseekApiPath("/chat/tts/"), wsBaseUrl);
      ttsUrl.searchParams.set("chat_session_id", String(sessionId));
      ttsUrl.searchParams.set("message_id", String(messageId));
      ttsUrl.searchParams.set("ticket", ticket);
      ttsUrl.searchParams.set("mode", "manual");
      ttsUrl.searchParams.set("format", format);

      const audioBuffer = await downloadTtsAudio({
        url: ttsUrl.toString(),
        proxy: currentAccount?.proxy
      });

      if (audioBuffer && audioBuffer.length > 0) {
        return { audioBuffer, refreshedAccount: currentAccount };
      }
      throw new Error("Empty audio buffer received");
    } catch (err) {
      lastError = err;
      console.warn(`[TTS] Attempt ${attempt} failed: ${err.message}`);
      if (attempt < maxRetries) {
        console.log(`[TTS] Retrying in ${500 * attempt}ms...`);
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  throw lastError;
}

export async function synthesizeSpeech({ account, prompt, voice = "echo", format = "opus" }) {
  let sessionId = null;
  let currentAccount = account;
  const startedAt = Date.now();

  try {
    const targetVoice = voice || "echo";
    console.log(`\n[TTS] ===== Bắt đầu Speech Request (voice: ${targetVoice}, format: ${format}) =====`);
    currentAccount = await ensureAccountVoice(currentAccount, targetVoice);

    console.log(`[TTS] 1. Creating chat session...`);
    sessionId = await createChatSession(currentAccount);
    console.log(`[TTS] 1. Session created: ${sessionId}`);

    const completionBody = {
      chat_session_id: sessionId,
      parent_message_id: null,
      model_type: null,
      prompt: `${SYSTEM_PROMPT_PREFIX}${prompt}`,
      ref_file_ids: [],
      thinking_enabled: false,
      search_enabled: false,
      action: null,
      preempt: false
    };

    console.log(`[TTS] 2. Sending prompt to chat completion...`);
    const chatStart = Date.now();
    const chatResponse = await collectDeepseekChatResponse({
      account: currentAccount,
      body: completionBody
    });
    console.log(`[TTS] 2. Prompt completed in ${Date.now() - chatStart}ms`);

    if (chatResponse.refreshedAccount) {
      currentAccount = chatResponse.refreshedAccount;
    }

    const messageId =
      chatResponse.result?.responseMessageId ??
      chatResponse.payload?.data?.biz_data?.response_message_id ??
      2;
    console.log(`[TTS] 3. Assistant response message_id: ${messageId}`);

    const { audioBuffer, refreshedAccount: finalAccount } = await downloadAudioWithRetry({
      account: currentAccount,
      sessionId,
      messageId,
      format,
      maxRetries: 3
    });

    console.log(`[TTS] ===== Hoàn thành Speech Request (${Date.now() - startedAt}ms, audio: ${audioBuffer.length} bytes) =====\n`);
    return {
      audioBuffer,
      format,
      refreshedAccount: finalAccount
    };
  } catch (error) {
    console.error(`[TTS] Error during speech synthesis:`, error.message);
    throw error;
  } finally {
    if (sessionId) {
      try {
        console.log(`[TTS] Cleaning up chat session ${sessionId}...`);
        //await deleteChatSession(currentAccount, sessionId);
        console.log(`[TTS] Session ${sessionId} deleted.`);
      } catch (cleanupError) {
        console.warn(`[TTS] Failed to clean up chat session ${sessionId}:`, cleanupError.message);
      }
    }
  }
}
