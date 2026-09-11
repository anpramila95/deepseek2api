import { updateStore, readStore } from "../storage/store.js";
import { createId } from "../utils/id.js";
import { maskIdentifier } from "../utils/privacy.js";
import { getSystemSettings } from "./system-settings-service.js";

function withUpdatedRecord(account, nextFields) {
  return {
    ...account,
    ...nextFields,
    updatedAt: new Date().toISOString(),
  };
}

export function listAccounts() {
  return readStore().accounts;
}

export function isAccountInRateLimitCooldown(account) {
  if (!account?.rateLimitedAt) return false;
  const settings = getSystemSettings();
  const cooldownMs = settings.rateLimitCooldownMs ?? 3_600_000;
  const elapsed = Date.now() - Date.parse(account.rateLimitedAt);
  return Number.isFinite(elapsed) && elapsed < cooldownMs;
}

export function markAccountRateLimited(accountId) {
  if (!accountId) return;
  updateAccountById(accountId, {
    rateLimitedAt: new Date().toISOString()
  });
}

export function clearAccountRateLimited(accountId) {
  if (!accountId) return;
  updateAccountById(accountId, {
    rateLimitedAt: null
  });
}

export function isUsableAccount(account) {
  return Boolean(
    account?.id &&
    account?.token &&
    account?.status !== "captcha_required" &&
    !account?.captchaState?.triggered &&
    !isAccountInRateLimitCooldown(account)
  );
}

export function listUsableAccounts() {
  return listAccounts().filter(isUsableAccount);
}

export function getAccountById(accountId) {
  return listAccounts().find((account) => account.id === accountId) ?? null;
}

export function resolveAccountLabel(account) {
  return (
    [
      account?.loginValue,
      account?.displayName,
      account?.loginValueMasked,
      account?.emailMasked,
      account?.mobileMasked,
      account?.id,
    ].find(Boolean) ?? ""
  );
}

export function findAccountForOwner(ownerId, deepseekUserId) {
  return (
    listAccounts().find(
      (account) =>
        account.ownerId === ownerId &&
        account.deepseekUserId === deepseekUserId,
    ) ?? null
  );
}

export function listAccountsForOwner(ownerId) {
  return listAccounts().filter((account) => account.ownerId === ownerId);
}

export function listUsableAccountsForOwner(ownerId) {
  return listAccountsForOwner(ownerId).filter(isUsableAccount);
}

export function saveAccount(accountInput) {
  const existing = accountInput.deepseekUserId
    ? findAccountForOwner(accountInput.ownerId, accountInput.deepseekUserId)
    : null;

  const account = existing
    ? withUpdatedRecord(existing, accountInput)
    : {
        id: createId(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...accountInput,
      };

  updateStore((state) => ({
    ...state,
    accounts: existing
      ? state.accounts.map((entry) =>
          entry.id === account.id ? account : entry,
        )
      : [...state.accounts, account],
  }));

  return account;
}

export function updateAccountById(accountId, patch) {
  let nextAccount = null;

  updateStore((state) => ({
    ...state,
    accounts: state.accounts.map((account) => {
      if (account.id !== accountId) {
        return account;
      }

      nextAccount = withUpdatedRecord(account, patch);
      return nextAccount;
    }),
  }));

  return nextAccount;
}

export function deleteAccountById(accountId) {
  let deletedAccount = null;

  updateStore((state) => {
    deletedAccount =
      state.accounts.find((account) => account.id === accountId) ?? null;
    if (!deletedAccount) {
      return state;
    }

    return {
      ...state,
      accounts: state.accounts.filter((account) => account.id !== accountId),
    };
  });

  return deletedAccount;
}
