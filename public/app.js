import { proxyJson, requestJson } from "/api.js";
import { bindActions } from "/actions.js";
import { INITIAL_STATE, ELEMENT_IDS } from "/app-constants.js";
import { createAppServices } from "/app-services.js";
import { createDraftFileController } from "/draft-file-controller.js";
import {
  consumeAssistantResponse,
  createDraftFileRecord,
  requestChatCompletion,
  resolveDraftFileIds,
  uploadDraftFile
} from "/chat-client.js";
import { resolveChatModel } from "/chat-models.js";
import { appendDelta } from "/deepseek-message.js";
import { initializeResponseModeControl, isStreamModeEnabled } from "/response-mode.js";
import { createSessionWorkspace } from "/session-workspace.js";
import { setupMotionEffects } from "/motion.js";
import { createDeltaStreamer } from "/streaming-text.js";
import { setupAuthTabs } from "/auth-ui.js";
import { setupThemeController } from "/theme.js";
import { getActiveTab, setActiveTab, setupTabs, wireRippleEffects } from "/ui.js";
import { collectElements, createView, setStatus } from "/view.js";
let state = freezeState(INITIAL_STATE);
const REQUEST_LOG_POLL_TABS = new Set(["dashboard", "explorer"]);
const els = collectElements(ELEMENT_IDS);
const themeController = setupThemeController();
let view;
let workspace;
let draftFiles;
let iconRenderFrame = 0;

function renderLucideIcons() {
  if (!window.lucide) {
    return;
  }

  window.lucide.createIcons({
    attrs: {
      "aria-hidden": "true",
      "stroke-width": "1.8"
    }
  });
}

function scheduleLucideRender() {
  if (iconRenderFrame) {
    return;
  }

  iconRenderFrame = window.requestAnimationFrame(() => {
    iconRenderFrame = 0;
    renderLucideIcons();
  });
}

function setupLucideIcons() {
  const root = document.querySelector(".app-shell");
  if (!root) {
    return;
  }

  const observer = new MutationObserver((records) => {
    const hasNewIcon = records.some((record) => Array.from(record.addedNodes).some((node) => (
      node instanceof Element
      && (node.matches("i[data-lucide]") || node.querySelector("i[data-lucide]"))
    )));

    if (hasNewIcon) {
      scheduleLucideRender();
    }
  });

  observer.observe(root, { childList: true, subtree: true });
  scheduleLucideRender();
  window.addEventListener("load", scheduleLucideRender, { once: true });
}

function getSelectedModel() {
  return resolveChatModel(els["model-select"].value);
}

function selectedModelSupportsUploads() {
  return getSelectedModel().supportsUploads !== false;
}

const services = createAppServices({
  bootstrap,
  clearComposerInput: () => draftFiles.clearComposerInput(),
  els,
  getApiKeys: () => state.apiKeys,
  getSelectedAccountId: () => state.selectedAccountId,
  loadSessions: () => workspace.loadSessions(),
  setAppState: updateState,
  setStatus,
  view: {
    renderDashboard: () => view.renderDashboard(),
    renderApiKeys: () => view.renderApiKeys(),
    renderMetrics: () => view.renderMetrics(),
    renderRequestLogs: () => view.renderRequestLogs(),
    renderShell: () => view.renderShell()
  }
});
view = createView({
  els,
  getSelectedModel,
  onDeleteAccount: services.deleteAccount,
  getState: () => state,
  onDeleteDraftFile: (localId) => draftFiles.deleteDraftFile(localId),
  onDeleteKey: services.handleApiKeyDelete,
  onToggleKeyToolCalls: async (keyId, enabled) => {
    try {
      await services.updateApiKey(keyId, enabled);
      setStatus(els["api-key-output"], "");
    } catch (error) {
      setStatus(els["api-key-output"], error.message);
      throw error;
    }
  },
  onSelectSession: (sessionId) => workspace.handleSessionSelect(sessionId),
  onToggleSelectSession: (sessionIds) => {
    updateState({ selectedSessionIds: sessionIds });
    view.renderSessions();
  },
  onDeleteSelected: async (selectedIds = state.selectedSessionIds) => {
    const accountId = state.selectedAccountId || state.accounts[0]?.id || "";
    if (!selectedIds.length) {
      setStatus(els["app-status"], "Vui lòng chọn phiên cần xóa.");
      return;
    }
    if (!accountId) {
      setStatus(els["app-status"], "Chưa chọn tài khoản.");
      return;
    }

    setStatus(els["app-status"], "Đang xóa...");
    try {
      for (const sessionId of selectedIds) {
        await proxyJson("/chat_session/delete", {
          accountId,
          method: "POST",
          body: { chat_session_id: sessionId }
        });
      }
      const remaining = state.sessions.filter((session) => !selectedIds.includes(session.id));
      const removedActiveSession = selectedIds.includes(state.selectedSessionId);
      updateState({
        currentMessageId: removedActiveSession ? null : state.currentMessageId,
        messages: removedActiveSession ? [] : state.messages,
        sessions: remaining,
        selectedSessionIds: [],
        selectedSessionId: remaining.some((session) => session.id === state.selectedSessionId)
          ? state.selectedSessionId
          : ""
      });
      view.renderSessions();
      view.renderMessages();
      view.renderMetrics();
      setStatus(els["app-status"], "");
    } catch (error) {
      setStatus(els["app-status"], error.message);
    }
  },
  themeController
});
workspace = createSessionWorkspace({
  accountRequiredMessage: "Vui lòng chọn tài khoản khả dụng trước.",
  appStatusElement: els["app-status"],
  getState: () => state,
  isIncognitoEnabled,
  resetConversation,
  setAppState: updateState,
  setStatus,
  view
});
draftFiles = createDraftFileController({
  fileInput: els["file-input"],
  getDraftFiles: () => state.draftFiles,
  promptInput: els["prompt-input"],
  renderComposer: () => view.renderComposer(),
  setAppState: updateState
});
function freezeState(value) {
  return Object.freeze({ ...value });
}
function shouldRefreshRequestLogs() {
  return Boolean(state.session)
    && REQUEST_LOG_POLL_TABS.has(getActiveTab())
    && document.visibilityState !== "hidden";
}
function refreshRequestLogsIfVisible() {
  if (!shouldRefreshRequestLogs()) {
    return;
  }

  services.loadRequestLogs().catch(() => {});
}
function updateState(patch) {
  state = freezeState({ ...state, ...patch });
}
function resolveSelectedAccountId(accounts) {
  return accounts.some((account) => account.id === state.selectedAccountId)
    ? state.selectedAccountId
    : (accounts[0]?.id || "");
}
function buildAuthenticatedState(me, discovery) {
  return {
    ...INITIAL_STATE,
    session: me,
    accounts: me.accounts,
    apiKeys: me.apiKeys,
    adminData: me.adminData ?? INITIAL_STATE.adminData,
    registration: me.registration ?? INITIAL_STATE.registration,
    systemSettings: me.systemSettings ?? me.adminData?.systemSettings ?? INITIAL_STATE.systemSettings,
    selectedAccountId: resolveSelectedAccountId(me.accounts),
    discoveredPaths: discovery.paths
  };
}
function toDisplayFile(file) {
  return {
    id: file.id || file.localId,
    errorCode: file.errorCode,
    fileName: file.fileName,
    fileSize: file.fileSize,
    previewable: file.previewable,
    status: file.status,
    tokenUsage: file.tokenUsage
  };
}
function isIncognitoEnabled() {
  return Boolean(state.session?.incognito?.effectiveEnabled);
}
function renderOptimisticPrompt(prompt, files) {
  updateState({
    messages: [
      ...state.messages,
      { role: "USER", files, sections: prompt ? [{ kind: "response", content: prompt }] : [] },
      { role: "ASSISTANT", files: [], sections: [] }
    ]
  });
  view.renderMessages();
  view.renderMetrics();
}
function applyAssistantDelta(delta) {
  updateState({
    messages: [...state.messages.slice(0, -1), appendDelta(state.messages.at(-1), delta)]
  });
  view.renderLatestMessage(delta);
}
function replaceAssistantMessage(message) {
  updateState({
    messages: [...state.messages.slice(0, -1), message]
  });
  view.replaceLatestMessage();
}
function restoreFailedSend(snapshot) {
  els["prompt-input"].value = snapshot.prompt;
  updateState({
    currentMessageId: snapshot.currentMessageId,
    draftFiles: snapshot.draftFiles,
    messages: snapshot.messages
  });
  view.renderMessages();
  view.renderMetrics();
  view.renderComposer();
}
function resetConversation() {
  updateState({
    currentMessageId: null,
    messages: [],
    selectedSessionId: ""
  });
  view.renderShell();
  return "";
}

async function bootstrap() {
  setStatus(els["app-status"], "");
  const me = await requestJson("/api/me");
  view.applyRegistration(me.registration);

  if (!me.authenticated) {
    updateState({
      ...INITIAL_STATE,
      registration: me.registration ?? INITIAL_STATE.registration,
      systemSettings: me.systemSettings ?? INITIAL_STATE.systemSettings
    });
    draftFiles.clearComposerInput();
    view.setView(false);
    return;
  }

  const discovery = await requestJson("/api/discovery");
  updateState(buildAuthenticatedState(me, discovery));
  draftFiles.clearComposerInput();
  view.setView(true);
  view.renderShell();
  await workspace.loadSessions();
  await services.loadRequestLogs();
}

async function uploadFiles(files) {
  if (!state.selectedAccountId) {
    throw new Error("Vui lòng chọn tài khoản khả dụng trước.");
  }

  if (!selectedModelSupportsUploads()) {
    throw new Error("Chế độ chuyên gia không hỗ trợ tải tệp lên.");
  }

  const nextDraftFiles = files.map(createDraftFileRecord);
  draftFiles.setDraftFiles([...state.draftFiles, ...nextDraftFiles]);
  const results = await Promise.allSettled(nextDraftFiles.map(async (draftFile) => {
    const finalFile = await uploadDraftFile({
      accountId: state.selectedAccountId,
      draftFile,
      onUpdate: (file) => draftFiles.updateDraftFile(draftFile.localId, file)
    });
    if (finalFile.status !== "SUCCESS") {
      throw new Error(`${draftFile.fileName}: ${finalFile.errorCode || finalFile.status}`);
    }
  }));
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length === nextDraftFiles.length && failed[0]?.reason) {
    throw failed[0].reason;
  }
}

async function sendPrompt() {
  const prompt = els["prompt-input"].value.trim();
  if (!prompt && !state.draftFiles.length) {
    return;
  }

  const selectedModel = resolveChatModel(els["model-select"].value);
  if (selectedModel.supportsUploads === false && state.draftFiles.length) {
    throw new Error("Chế độ chuyên gia không hỗ trợ tải tệp lên.");
  }

  const sessionId = state.selectedSessionId || await workspace.createRemoteSession(!isIncognitoEnabled());
  const snapshot = {
    currentMessageId: state.currentMessageId,
    draftFiles: state.draftFiles,
    messages: state.messages,
    prompt
  };
  const deltaStreamer = createDeltaStreamer({ onDelta: applyAssistantDelta });
  const refFileIds = resolveDraftFileIds(snapshot.draftFiles);
  els["prompt-input"].value = "";
  updateState({ draftFiles: [], isSending: true });
  renderOptimisticPrompt(prompt, snapshot.draftFiles.map(toDisplayFile));
  view.renderComposer();

  try {
    const streamEnabled = isStreamModeEnabled(els["response-mode"]);
    const response = await requestChatCompletion({
      accountId: state.selectedAccountId,
      modelType: selectedModel.modelType,
      parentMessageId: snapshot.currentMessageId,
      prompt,
      refFileIds,
      searchEnabled: selectedModel.searchEnabled,
      sessionId,
      stream: streamEnabled,
      thinkingEnabled: selectedModel.thinkingEnabled
    });
    const handleDelta = streamEnabled ? (delta) => deltaStreamer.push(delta) : undefined;
    const result = await consumeAssistantResponse({
      onComplete: (message) => replaceAssistantMessage(message),
      response,
      onDelta: handleDelta,
      onReady: (payload) => updateState({
        currentMessageId: payload.response_message_id ?? state.currentMessageId
      })
    });
    if (streamEnabled) {
      await deltaStreamer.flush();
      if (result?.message) {
        replaceAssistantMessage(result.message);
      }
    }
    await workspace.handleAfterSendSuccess(sessionId);
  } catch (error) {
    deltaStreamer.cancel();
    restoreFailedSend(snapshot);
    throw error;
  } finally {
    updateState({ isSending: false });
    view.renderComposer();
  }
}

setupAuthTabs();
setupTabs();
initializeResponseModeControl(els["response-mode"]);
setActiveTab("dashboard");
wireRippleEffects();
setupLucideIcons();
setupMotionEffects();
els["model-select"].onchange = () => {
  if (!selectedModelSupportsUploads() && state.draftFiles.length) {
    draftFiles.setDraftFiles([]);
  }
  view.renderComposer();
};
bindActions({
  els,
  onAccountChange: services.changeAccount,
  onAddAccount: services.addAccount,
  onBatchDeleteInvites: services.deleteInvites,
  onBatchDeleteUsers: services.batchDeleteUsers,
  onBatchDisableUsers: services.batchDisableUsers,
  onCheckAccounts: services.checkAccounts,
  onCreateInvites: services.createInvites,
  onCreateSession: workspace.createSessionAction,
  onDeleteInvite: services.deleteInvite,
  onDeleteUser: services.deleteUser,
  onResolveCaptcha: services.resolveCaptcha,
  onRetryCaptcha: services.retryCaptcha,
  onClearCaptcha: services.clearCaptcha,
  onExplorerSubmit: services.submitExplorer,
  onLogin: services.login,
  onLogout: services.logout,
  onRefreshRequestLogs: services.loadRequestLogs,
  onRefreshSessions: workspace.loadSessions,
  onRegister: services.register,
  onSendPrompt: sendPrompt,
  onSubmitApiKey: services.submitApiKey,
  onToggleChainOfThoughtOverride: services.toggleChainOfThoughtOverride,
  onToggleIncognito: services.toggleIncognito,
  onToggleSharedAccountMode: services.toggleSharedAccountMode,
  onToggleToolParsingMode: services.toggleToolParsingMode,
  onUpdateSystemSettings: services.updateSystemSettings,
  onToggleInviteRequirement: services.updateRegistration,
  onUpdateUser: services.updateUser,
  onUploadFiles: uploadFiles,
  setStatus
});
document.addEventListener("apptabchange", (event) => {
  if (state.session) {
    view.renderHeader();
  }

  if (state.session && event.detail?.tab === "keys") {
    services.loadApiKeys().catch(() => {});
  }

  refreshRequestLogsIfVisible();
});
document.addEventListener("themechange", () => {
  if (state.session) {
    view.renderHeader();
  }
});
document.addEventListener("visibilitychange", refreshRequestLogsIfVisible);
bootstrap().catch((error) => setStatus(els["app-status"], error.message));
window.setInterval(refreshRequestLogsIfVisible, 5000);
