import { redactSensitiveText } from "../utils/privacy.js";
import { updateStore } from "../storage/store.js";

const MAX_LOGS = 500;
const requestLogs = [];
let nextLogId = 1;

export function recordRequestLog(entry) {
  const record = {
    id: nextLogId++,
    at: new Date().toISOString(),
    method: entry.method || "GET",
    path: entry.path || "",
    model: entry.model || "",
    ownerId: entry.ownerId || "",
    accountId: entry.accountId || "",
    status: entry.status ?? null,
    durationMs: entry.durationMs ?? null,
    error: redactSensitiveText(entry.error || ""),
    usage: {
      promptTokens: Number(entry.usage?.promptTokens) || 0,
      completionTokens: Number(entry.usage?.completionTokens) || 0,
      totalTokens: Number(entry.usage?.totalTokens) || 0
    }
  };

  requestLogs.unshift(record);
  updateStore((state) => {
    const usage = state.usageStats ?? {};
    const path = record.path || "unknown";
    return {
      ...state,
      usageStats: {
        totalTokens: (usage.totalTokens || 0) + record.usage.totalTokens,
        promptTokens: (usage.promptTokens || 0) + record.usage.promptTokens,
        completionTokens: (usage.completionTokens || 0) + record.usage.completionTokens,
        requests: (usage.requests || 0) + 1,
        byPath: { ...(usage.byPath || {}), [path]: ((usage.byPath || {})[path] || 0) + 1 }
      }
    };
  });
  if (requestLogs.length > MAX_LOGS) {
    requestLogs.length = MAX_LOGS;
  }

  return record;
}

export function listRequestLogs({ limit = 100, ownerId, includeAll = false } = {}) {
  const count = Math.max(1, Math.min(Number(limit) || 100, MAX_LOGS));
  const source = includeAll
    ? requestLogs
    : requestLogs.filter((record) => record.ownerId === ownerId);

  return source.slice(0, count);
}
