import { listUsableAccounts, listUsableAccountsForOwner } from "./account-service.js";
import { isSharedAccountModeEnabled } from "./shared-account-mode-service.js";

const lastAccountIds = new Map();
const SHARED_ACCOUNT_POOL = "shared";

function resolveAccountPool(ownerId, sharedModeEnabled) {
  return sharedModeEnabled ? listUsableAccounts() : listUsableAccountsForOwner(ownerId);
}

function resolvePoolKey(ownerId, sharedModeEnabled) {
  return sharedModeEnabled ? SHARED_ACCOUNT_POOL : `owner:${ownerId}`;
}

function resolveNextIndex(accounts, lastAccountId) {
  const lastIndex = accounts.findIndex((account) => account.id === lastAccountId);
  return lastIndex === -1 ? 0 : (lastIndex + 1) % accounts.length;
}

function takeAccountAfter(apiKeyRecord, afterAccountId) {
  const sharedModeEnabled = isSharedAccountModeEnabled();
  const accounts = resolveAccountPool(apiKeyRecord.ownerId, sharedModeEnabled);
  if (!accounts.length) {
    return null;
  }

  const poolKey = resolvePoolKey(apiKeyRecord.ownerId, sharedModeEnabled);
  const nextAccount = accounts[resolveNextIndex(accounts, afterAccountId)];
  lastAccountIds.set(poolKey, nextAccount.id);
  return nextAccount;
}

export function takeRoundRobinAccount(apiKeyRecord) {
  const sharedModeEnabled = isSharedAccountModeEnabled();
  const poolKey = resolvePoolKey(apiKeyRecord.ownerId, sharedModeEnabled);
  return takeAccountAfter(apiKeyRecord, lastAccountIds.get(poolKey));
}

export function takeNextRoundRobinAccount(apiKeyRecord, currentAccountId) {
  return takeAccountAfter(apiKeyRecord, currentAccountId);
}
