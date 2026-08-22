import { resolveAccountLabel } from "/account-display.js";
import { renderAccountListView } from "/account-list-view.js";
import { renderInviteList, renderUserList } from "/admin-ui.js";
import { applyRegistrationState, toggleAdminTab } from "/auth-ui.js";
import { patchLastMessageDelta, renderMessageList, replaceLastMessage } from "/message-list-view.js";
import { renderSessionList } from "/session-list-view.js";
import { getThemeMeta } from "/theme.js";
import {
  getActiveTab,
  renderAccountOptions,
  renderApiKeyList,
  renderDashboardHome,
  renderDraftFileList,
  renderRequestLogList,
  renderSystemSettingsForm,
  resolveTabLabel,
  setPageTitle,
  setSelectOptions,
  updateDashboardMetrics
} from "/ui.js";

function setText(element, value) {
  element.textContent = value || "";
}

function summarizeAccounts(accounts, fallbackLabel) {
  const labels = accounts.map(resolveAccountLabel).filter(Boolean);
  return labels.length ? labels.join(" / ") : fallbackLabel;
}

function getUserSummary(state) {
  return state.session?.username || summarizeAccounts(state.accounts, "Chưa liên kết tài khoản");
}

function resolveSelectedSession(state) {
  return state.sessions.find((session) => session.id === state.selectedSessionId) ?? null;
}

function resolvePageTitle(state) {
  const activeTab = getActiveTab();
  if (activeTab !== "chat") {
    return resolveTabLabel(activeTab);
  }

  return resolveSelectedSession(state)?.title || resolveTabLabel(activeTab);
}

function describeIncognito(incognito, role) {
  if (!incognito.effectiveEnabled) {
    return "Hiện tại: Tắt";
  }

  if (role === "admin" && incognito.globalEnabled) {
    return "Hiện tại: Bật toàn cục";
  }

  if (incognito.globalEnabled) {
    return "Hiện tại: Quản trị viên đã bật";
  }

  return "Hiện tại: Chỉ bật cho cá nhân";
}

function describeChainOfThoughtOverride(state) {
  if (state?.globalEnabled) {
    return "Hiện tại: Quản trị viên đã bật toàn cục (Thử nghiệm)";
  }

  if (state?.ownerEnabled) {
    return "Hiện tại: Chỉ bật cho cá nhân (Thử nghiệm)";
  }

  return "Hiện tại: Tắt (Thử nghiệm)";
}

function describeToolParsingMode(state) {
  const behavior = "Khi phát hiện trường tool trong nội dung, chỉ gửi nội dung và gợi ý tool cho chế độ nhanh để sắp xếp thành lời gọi công cụ chính thức.";

  if (state?.globalEnabled) {
    return `Hiện tại: Quản trị viên đã bật toàn cục. ${behavior}`;
  }

  if (state?.ownerEnabled) {
    return `Hiện tại: Chỉ bật cho cá nhân. ${behavior}`;
  }

  return `Hiện tại: Tắt. ${behavior}`;
}

function getIncognitoSummary(incognito, role) {
  if (!incognito.effectiveEnabled) {
    return "Tắt";
  }

  if (role === "admin" && incognito.globalEnabled) {
    return "Toàn cục";
  }

  return incognito.globalEnabled ? "Toàn cục" : "Cá nhân";
}

function getSharedModeSummary(sharedMode) {
  return sharedMode?.enabled ? "Bật" : "Tắt";
}

function describeSharedMode(sharedMode, incognito) {
  if (!sharedMode?.canToggle) {
    return sharedMode?.enabled
      ? "Quản trị viên đã bật, API sẽ xoay vòng giữa tất cả tài khoản khả dụng trên toàn hệ thống."
      : "Quản trị viên chưa bật.";
  }

  if (!incognito.globalEnabled) {
    return "Cần bật chế độ ẩn danh toàn cục trước khi bật dùng chung tài khoản.";
  }

  return sharedMode.enabled
    ? "Đã bật, tất cả API Key dùng chung xoay vòng tài khoản DeepSeek khả dụng."
    : "Sau khi bật, tất cả API Key sẽ dùng chung xoay vòng tài khoản DeepSeek khả dụng.";
}

export function collectElements(ids) {
  return Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
}

export function setStatus(element, value) {
  const text = value || "";
  element.textContent = text;
  element.classList.toggle("hidden", !text);
}

export function createView(options) {
  const {
    els,
    getSelectedModel,
    getState,
    onDeleteAccount,
    onDeleteDraftFile,
    onDeleteKey,
    onToggleKeyToolCalls,
    onSelectSession,
    themeController
  } = options;
  const currentState = () => getState();

  function renderHeader() {
    const state = currentState();
    const roleLabel = state.session?.role === "admin" ? "Quản trị viên" : "Người dùng";
    const themeMeta = getThemeMeta(themeController.getTheme());
    const incognito = state.session?.incognito;

    setPageTitle(resolvePageTitle(state));
    setText(els["active-theme-label"], themeMeta.label);
    setText(els["role-label"], roleLabel);
    setText(els["user-summary"], getUserSummary(state));
    setText(
      els["incognito-summary"],
      incognito ? getIncognitoSummary(incognito, state.session.role) : ""
    );
    setText(els["shared-mode-summary"], getSharedModeSummary(state.session?.sharedAccountMode));
    if (els["new-session"]) {
      els["new-session"].classList.toggle("hidden", getActiveTab() !== "chat");
    }
  }

  function renderSessions() {
    const state = currentState();
    renderSessionList({
      container: els.sessions,
      onSelect: onSelectSession,
      selectedSessionId: state.selectedSessionId,
      sessions: state.sessions
    });
  }

  function renderMessages() {
    renderMessageList({ container: els.messages, messages: currentState().messages });
  }

  function renderLatestMessage(delta) {
    const state = currentState();
    patchLastMessageDelta({
      container: els.messages,
      delta,
      messages: state.messages
    });
  }

  function replaceLatestMessage() {
    const state = currentState();
    replaceLastMessage({
      container: els.messages,
      message: state.messages.at(-1),
      messages: state.messages
    });
  }

  function renderComposer() {
    const state = currentState();
    const selectedModel = getSelectedModel();
    const supportsUploads = selectedModel?.supportsUploads !== false;
    renderDraftFileList({
      container: els["draft-files"],
      files: state.draftFiles,
      onDelete: onDeleteDraftFile
    });
    els["attach-files"].classList.toggle("hidden", !supportsUploads);
    els["attach-files"].disabled = state.isSending || !supportsUploads;
    els["file-input"].disabled = state.isSending || !supportsUploads;
    els["send-button"].disabled = state.isSending;
  }

  function renderSettings() {
    const state = currentState();
    const chainOfThoughtOverride = state.session.chainOfThoughtOverride ?? {};
    const toolParsingMode = state.session.toolParsingMode ?? {};
    const incognito = state.session.incognito;
    const sharedMode = state.session.sharedAccountMode ?? { enabled: false, canToggle: false };
    const label = incognito.scope === "global" ? "Bật cho tất cả" : "Chỉ bật cho cá nhân";
    const canToggleSharedMode = Boolean(sharedMode.canToggle);
    const canEnableSharedMode = canToggleSharedMode && Boolean(incognito.globalEnabled);
    const sharedModeSubmit = els["shared-mode-form"].querySelector("button[type='submit']");

    renderAccountListView({
      accounts: state.accounts,
      container: els["account-list"],
      isAdmin: state.session.role === "admin",
      onDeleteAccount,
      selectedAccountId: state.selectedAccountId
    });
    setText(els["incognito-label"], label);
    setText(els["incognito-description"], describeIncognito(incognito, state.session.role));
    els["incognito-toggle"].checked = Boolean(incognito.scopeEnabled);
    setText(els["cot-override-label"], "Chỉ bật cho cá nhân (Thử nghiệm)");
    setText(
      els["cot-override-description"],
      describeChainOfThoughtOverride(chainOfThoughtOverride)
    );
    els["cot-override-toggle"].checked = Boolean(chainOfThoughtOverride.ownerEnabled);
    setText(els["tool-parsing-label"], "Chỉ bật cho cá nhân");
    setText(
      els["tool-parsing-description"],
      describeToolParsingMode(toolParsingMode)
    );
    els["tool-parsing-toggle"].checked = Boolean(toolParsingMode.ownerEnabled);
    els["shared-mode-panel"].classList.toggle("hidden", !canToggleSharedMode);
    setText(els["shared-mode-description"], describeSharedMode(sharedMode, incognito));
    setText(els["shared-mode-label"], sharedMode.enabled ? "Tắt dùng chung tài khoản" : "Bật dùng chung tài khoản");
    els["shared-mode-toggle"].checked = Boolean(sharedMode.enabled);
    els["shared-mode-toggle"].disabled = !canEnableSharedMode;
    if (sharedModeSubmit) {
      sharedModeSubmit.disabled = !canEnableSharedMode;
    }
  }

  function renderAdmin() {
    const state = currentState();
    const enabled = state.session?.role === "admin";
    toggleAdminTab(els, enabled);

    if (!enabled) {
      return;
    }

    els["invite-required-toggle"].checked = Boolean(state.adminData.registration.inviteRequired);
    applyRegistrationState(els, state.registration);
    renderInviteList(els["admin-invite-list"], state.adminData.invites);
    renderUserList(els["admin-user-list"], state.adminData.users);
  }

  function renderMetrics() {
    const state = currentState();

    updateDashboardMetrics({
      apiKeyCountElement: els["api-key-count"],
      counts: {
        apiKeys: state.apiKeys.length,
        endpoints: state.discoveredPaths.length,
        messages: state.messages.length,
        sessions: state.sessions.length
      },
      endpointCountElement: els["endpoint-count"],
      messageCountElement: els["message-count"],
      sessionCaptionElement: els["session-caption"],
      sessionCountElement: els["session-count"],
      sessionMetricElement: els["metric-session-count"]
    });
  }

  function renderApiKeys() {
    const state = currentState();
    renderApiKeyList({
      container: els["api-keys"],
      keys: state.apiKeys,
      onDelete: onDeleteKey,
      onToggleToolCalls: onToggleKeyToolCalls
    });
  }

  function renderRequestLogs() {
    renderRequestLogList({
      container: els["request-log-list"],
      logs: currentState().requestLogs
    });
  }

  function renderDashboard() {
    renderDashboardHome({
      containers: {
        captchaAlerts: els["captcha-alert-list"],
        healthCards: els["dashboard-health-cards"],
        recentLogs: els["dashboard-recent-logs"],
        requestChart: els["dashboard-request-chart"]
      },
      state: currentState()
    });
  }

  function renderSystemSettings() {
    const state = currentState();
    setText(els["settings-origin"], window.location.origin);
    setText(
      els["settings-registration-summary"],
      state.registration?.inviteRequired ? "Yêu cầu mã mời" : "Đăng ký tự do"
    );
    renderSystemSettingsForm({
      accounts: state.accounts,
      elements: {
        autoSolve: els["settings-auto-solve"],
        clearKey: els["settings-clear-yescaptcha-key"],
        cooldownMs: els["settings-cooldown-ms"],
        endpoint: els["settings-endpoint"],
        inputContentLimit: els["settings-input-content-limit"],
        chainOfThoughtOverride: els["settings-cot-override"],
        toolParsingMode: els["settings-tool-parsing-mode"],
        maxRetries: els["settings-max-retries"],
        visionAccount: els["settings-vision-account"],
        visionFallback: els["settings-vision-fallback"],
        yescaptchaKey: els["settings-yescaptcha-key"]
      },
      isAdmin: state.session?.role === "admin",
      settings: state.systemSettings
    });
  }

  function renderShell() {
    const state = currentState();
    if (!state.session) {
      return;
    }

    renderHeader();
    renderAccountOptions({
      accounts: state.accounts,
      select: els["account-select"],
      selectedAccountId: state.selectedAccountId
    });
    renderSessions();
    renderMessages();
    renderComposer();
    renderSettings();
    renderAdmin();
    renderApiKeys();
    renderRequestLogs();
    renderDashboard();
    renderSystemSettings();
    setSelectOptions({ select: els["explorer-path"], values: state.discoveredPaths });
    renderMetrics();
  }

  return Object.freeze({
    applyRegistration(registration) {
      applyRegistrationState(els, registration);
    },
    renderComposer,
    renderApiKeys,
    renderDashboard,
    renderHeader,
    renderLatestMessage,
    renderMetrics,
    renderRequestLogs,
    renderMessages,
    replaceLatestMessage,
    renderSessions,
    renderShell,
    setView(authenticated) {
      els["login-view"].classList.toggle("hidden", authenticated);
      els["app-view"].classList.toggle("hidden", !authenticated);
      document.dispatchEvent(new CustomEvent("appviewchange", { detail: { authenticated } }));
    }
  });
}
