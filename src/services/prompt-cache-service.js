import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAccountById, isUsableAccount } from "./account-service.js";
import { createChatSession } from "./chat-session-service.js";

const DATA_DIR = fileURLToPath(new URL("../../data", import.meta.url));
const CACHE_FILE = join(DATA_DIR, "prompt-cache.txt");

function loadCacheMap() {
  const map = new Map();
  if (!existsSync(CACHE_FILE)) {
    return map;
  }
  try {
    const lines = readFileSync(CACHE_FILE, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const parts = trimmed.split("|");
      if (parts.length >= 3) {
        const [cacheKey, accountId, sessionId] = parts.map((p) => p.trim());
        if (cacheKey && accountId && sessionId) {
          map.set(cacheKey, { accountId, sessionId });
        }
      }
    }
  } catch (err) {
    console.error("[PromptCache] Error reading cache file:", err.message);
  }
  return map;
}

function persistCacheMap(map) {
  try {
    const lines = [];
    for (const [cacheKey, { accountId, sessionId }] of map.entries()) {
      lines.push(`${cacheKey}|${accountId}|${sessionId}`);
    }
    writeFileSync(CACHE_FILE, lines.join("\n") + (lines.length ? "\n" : ""), "utf-8");
  } catch (err) {
    console.error("[PromptCache] Error saving cache file:", err.message);
  }
}

export async function resolvePromptCacheSession({
  accountPicker,
  cacheKey,
}) {
  if (!cacheKey) {
    return null;
  }

  const cleanKey = String(cacheKey).trim();
  if (!cleanKey) {
    return null;
  }

  const cacheMap = loadCacheMap();
  const cached = cacheMap.get(cleanKey);

  if (cached) {
    const boundAccount = getAccountById(cached.accountId);
    if (boundAccount && isUsableAccount(boundAccount)) {
      return {
        account: boundAccount,
        sessionId: cached.sessionId,
        cacheKey: cleanKey,
        isCached: true,
      };
    }
  }

  // Create new session with a usable account
  const account = accountPicker();
  if (!account) {
    return null;
  }

  try {
    const sessionId = await createChatSession(account);
    cacheMap.set(cleanKey, {
      accountId: account.id,
      sessionId,
    });
    persistCacheMap(cacheMap);

    return {
      account,
      sessionId,
      cacheKey: cleanKey,
      isCached: false,
    };
  } catch (error) {
    console.error("[PromptCache] Failed to create chat session for cache key:", error.message);
    return null;
  }
}

export function updatePromptCacheSession(cacheKey, accountId, sessionId) {
  if (!cacheKey || !accountId || !sessionId) return;
  const cleanKey = String(cacheKey).trim();
  const cacheMap = loadCacheMap();
  cacheMap.set(cleanKey, {
    accountId: String(accountId).trim(),
    sessionId: String(sessionId).trim(),
  });
  persistCacheMap(cacheMap);
}

export function invalidatePromptCacheSession(cacheKey) {
  if (!cacheKey) return;
  const cleanKey = String(cacheKey).trim();
  const cacheMap = loadCacheMap();
  if (cacheMap.delete(cleanKey)) {
    persistCacheMap(cacheMap);
  }
}
