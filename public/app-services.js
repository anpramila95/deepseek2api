import { requestJson, proxyJson } from "/api.js";

async function postJson(url, body) {
  return requestJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function patchJson(url, body) {
  return requestJson(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

export function createAppServices(options) {
  const {
    bootstrap,
    clearComposerInput,
    els,
    getApiKeys = () => [],
    getSelectedAccountId,
    loadSessions,
    setAppState,
    setStatus,
    view
  } = options;

  // The API deliberately reveals a newly created key only once. Keep that
  // one-time value in browser memory so a bootstrap refresh does not make the
  // copy action look disabled immediately after creation.
  const revealedApiKeys = new Map();

  function mergeRevealedApiKeys(keys = []) {
    return keys.map((key) => {
      const revealed = revealedApiKeys.get(key.id);
      return revealed ? { ...key, key: revealed } : key;
    });
  }

  function applyApiKeyList(keys) {
    const visibleIds = new Set(keys.map((key) => key.id));
    revealedApiKeys.forEach((_, keyId) => {
      if (!visibleIds.has(keyId)) {
        revealedApiKeys.delete(keyId);
      }
    });
    setAppState({ apiKeys: mergeRevealedApiKeys(keys) });
    view.renderApiKeys?.();
    view.renderMetrics?.();
  }

  async function bootstrapWithRevealedApiKeys() {
    await bootstrap();
    applyApiKeyList(getApiKeys());
  }

  async function handleApiKeyDelete(keyId) {
    setStatus(els["api-key-output"], "");

    try {
      const response = await fetch(`/api/api-keys/${keyId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`删除失败: HTTP ${response.status}`);
      }
      revealedApiKeys.delete(keyId);
      await bootstrapWithRevealedApiKeys();
    } catch (error) {
      setStatus(els["api-key-output"], error.message);
    }
  }

  async function login({ password, username }) {
    revealedApiKeys.clear();
    await postJson("/api/auth/login", { username, password });
    await bootstrapWithRevealedApiKeys();
  }

  async function register({ inviteCode, password, username }) {
    revealedApiKeys.clear();
    await postJson("/api/auth/register", { inviteCode, password, username });
    await bootstrapWithRevealedApiKeys();
  }

  async function logout() {
    revealedApiKeys.clear();
    await requestJson("/api/auth/logout", { method: "POST" });
    await bootstrapWithRevealedApiKeys();
  }

  async function changeAccount(accountId) {
    clearComposerInput();
    setAppState({
      currentMessageId: null,
      messages: [],
      selectedAccountId: accountId,
      selectedSessionId: ""
    });
    view.renderShell();
    await loadSessions();
  }

  async function addAccount({ password, username }) {
    const payload = await postJson("/api/accounts", {
      username,
      password
    });

    els["account-password"].value = "";
    setAppState({ selectedAccountId: payload.account.id });
    await bootstrapWithRevealedApiKeys();
  }

  async function deleteAccount(accountId) {
    setStatus(els["account-status"], "删除中...");

    try {
      await requestJson(`/api/accounts/${accountId}`, { method: "DELETE" });
      await bootstrapWithRevealedApiKeys();
      setStatus(els["account-status"], "已删除绑定账号。");
    } catch (error) {
      setStatus(els["account-status"], error.message);
    }
  }

  async function resolveCaptcha(accountId, payload) {
    await postJson(`/api/accounts/${accountId}/captcha/resolve`, payload);
    await bootstrapWithRevealedApiKeys();
  }

  async function retryCaptcha(accountId) {
    await postJson(`/api/accounts/${accountId}/captcha/retry`, {});
    await bootstrapWithRevealedApiKeys();
  }

  async function clearCaptcha(accountId) {
    await postJson(`/api/accounts/${accountId}/captcha/clear`, {});
    await bootstrapWithRevealedApiKeys();
  }

  async function toggleIncognito(enabled) {
    await postJson("/api/incognito", { enabled });
    await bootstrapWithRevealedApiKeys();
  }

  async function toggleChainOfThoughtOverride(enabled) {
    await postJson("/api/chain-of-thought-override", { enabled });
    await bootstrapWithRevealedApiKeys();
  }

  async function toggleToolParsingMode(enabled) {
    await postJson("/api/tool-parsing-mode", { enabled });
    await bootstrapWithRevealedApiKeys();
  }

  async function toggleSharedAccountMode(enabled) {
    await postJson("/api/admin/shared-account-mode", { enabled });
    await bootstrapWithRevealedApiKeys();
  }

  async function submitApiKey({ label, plainKey, toolCallsEnabled }) {
    const payload = await postJson("/api/api-keys", {
      accountId: getSelectedAccountId(),
      label,
      plainKey,
      toolCallsEnabled
    });

    if (payload.record?.id && payload.key) {
      revealedApiKeys.set(payload.record.id, payload.key);
    }
    setStatus(els["api-key-output"], `新 Key：\n${payload.key}`);
    els["api-key-label"].value = "";
    els["api-key-plain"].value = "";
    els["api-key-tool-calls"].checked = false;
    await bootstrapWithRevealedApiKeys();
  }

  async function updateApiKey(keyId, toolCallsEnabled) {
    await patchJson(`/api/api-keys/${keyId}`, { toolCallsEnabled });
    await bootstrapWithRevealedApiKeys();
  }

  async function submitExplorer({ bodyText, method, path, queryText }) {
    const payload = await proxyJson(path, {
      accountId: getSelectedAccountId(),
      method,
      query: queryText ? JSON.parse(queryText) : {},
      body: bodyText ? JSON.parse(bodyText) : undefined
    });
    setStatus(els["explorer-output"], JSON.stringify(payload, null, 2));
  }

  async function loadRequestLogs() {
    const payload = await requestJson("/api/request-logs?limit=120");
    setAppState({ requestLogs: payload.logs ?? [] });
    view.renderRequestLogs?.();
    view.renderDashboard?.();
    view.renderMetrics?.();
  }

  async function loadApiKeys() {
    const payload = await requestJson("/api/api-keys");
    applyApiKeyList(payload.apiKeys ?? []);
  }

  async function updateRegistration(inviteRequired) {
    await postJson("/api/admin/registration", { inviteRequired });
    await bootstrapWithRevealedApiKeys();
  }

  async function updateSystemSettings(payload) {
    const result = await postJson("/api/admin/system-settings", payload);
    setAppState({
      systemSettings: result.systemSettings
    });
    await bootstrapWithRevealedApiKeys();
  }

  async function createInvites(count) {
    await postJson("/api/admin/invites", { count });
    await bootstrapWithRevealedApiKeys();
  }

  async function deleteInvite(inviteId) {
    await requestJson(`/api/admin/invites/${inviteId}`, { method: "DELETE" });
    await bootstrapWithRevealedApiKeys();
  }

  async function deleteInvites(inviteIds) {
    await postJson("/api/admin/invites/batch-delete", { inviteIds });
    await bootstrapWithRevealedApiKeys();
  }

  async function updateUser(userId, patch) {
    await patchJson(`/api/admin/users/${userId}`, patch);
    await bootstrapWithRevealedApiKeys();
  }

  async function deleteUser(userId) {
    await requestJson(`/api/admin/users/${userId}`, { method: "DELETE" });
    await bootstrapWithRevealedApiKeys();
  }

  async function batchDeleteUsers(userIds) {
    await postJson("/api/admin/users/batch-delete", { userIds });
    await bootstrapWithRevealedApiKeys();
  }

  async function batchDisableUsers({ disabled, userIds }) {
    await postJson("/api/admin/users/batch-disable", { disabled, userIds });
    await bootstrapWithRevealedApiKeys();
  }

  return Object.freeze({
    addAccount,
    batchDeleteUsers,
    batchDisableUsers,
    changeAccount,
    createInvites,
    clearCaptcha,
    deleteAccount,
    deleteInvite,
    deleteInvites,
    deleteUser,
    handleApiKeyDelete,
    login,
    loadApiKeys,
    loadRequestLogs,
    logout,
    register,
    resolveCaptcha,
    retryCaptcha,
    submitApiKey,
    submitExplorer,
    toggleChainOfThoughtOverride,
    toggleToolParsingMode,
    toggleSharedAccountMode,
    updateApiKey,
    toggleIncognito,
    updateSystemSettings,
    updateRegistration,
    updateUser
  });
}
