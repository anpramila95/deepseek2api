import { readStore, updateStore } from "../storage/store.js";
import { createApiKey, createId, hashValue } from "../utils/id.js";

function normalizeUsageCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

function toUsageDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const resolved = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = resolved.getFullYear();
  const month = String(resolved.getMonth() + 1).padStart(2, "0");
  const day = String(resolved.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sanitizeKey(record, now = new Date()) {
  const { key, keyHash, ...rest } = record;
  return {
    ...rest,
    todayUsage: record.usageDay === toUsageDay(now)
      ? normalizeUsageCount(record.todayUsage)
      : 0
  };
}

export function listApiKeysForOwner(ownerId) {
  return readStore().apiKeys
    .filter((record) => record.ownerId === ownerId)
    .map((record) => sanitizeKey(record));
}

export function createApiKeyRecord({
  ownerId,
  accountId,
  label,
  plainKey,
  toolCallsEnabled = false
}) {
  const key = plainKey || createApiKey();
  const record = {
    id: createId(),
    ownerId,
    accountId,
    label,
    keyHash: hashValue(key),
    preview: `${key.slice(0, 8)}...${key.slice(-4)}`,
    createdAt: new Date().toISOString(),
    todayUsage: 0,
    usageDay: toUsageDay(),
    toolCallsEnabled: Boolean(toolCallsEnabled)
  };

  updateStore((state) => ({
    ...state,
    apiKeys: [...state.apiKeys, record]
  }));

  return {
    key,
    record: sanitizeKey(record)
  };
}

export function deleteApiKeyRecord(ownerId, keyId) {
  updateStore((state) => ({
    ...state,
    apiKeys: state.apiKeys.filter(
      (record) => !(record.id === keyId && record.ownerId === ownerId)
    )
  }));
}

export function updateApiKeyRecord(ownerId, keyId, patch) {
  let updatedRecord = null;

  updateStore((state) => ({
    ...state,
    apiKeys: state.apiKeys.map((record) => {
      if (record.id !== keyId || record.ownerId !== ownerId) {
        return record;
      }

      updatedRecord = {
        ...record,
        toolCallsEnabled: Boolean(patch?.toolCallsEnabled)
      };
      return updatedRecord;
    })
  }));

  return updatedRecord ? sanitizeKey(updatedRecord) : null;
}

export function getApiKeyRecord(key) {
  const keyHash = hashValue(key);
  return readStore().apiKeys.find((record) => record.keyHash === keyHash) ?? null;
}

export function recordApiKeyUsage(keyId, usedAt = new Date()) {
  const usageDate = usedAt instanceof Date ? usedAt : new Date(usedAt);
  const resolvedDate = Number.isNaN(usageDate.getTime()) ? new Date() : usageDate;
  const usageDay = toUsageDay(resolvedDate);
  let updatedRecord = null;

  updateStore((state) => ({
    ...state,
    apiKeys: state.apiKeys.map((record) => {
      if (record.id !== keyId) {
        return record;
      }

      updatedRecord = {
        ...record,
        lastUsedAt: resolvedDate.toISOString(),
        todayUsage: record.usageDay === usageDay
          ? normalizeUsageCount(record.todayUsage) + 1
          : 1,
        usageDay
      };
      return updatedRecord;
    })
  }));

  return updatedRecord ? sanitizeKey(updatedRecord, resolvedDate) : null;
}
