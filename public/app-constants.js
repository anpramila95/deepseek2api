export const INITIAL_STATE = Object.freeze({
  session: null,
  accounts: [],
  apiKeys: [],
  adminData: {
    invites: [],
    registration: {
      inviteRequired: false
    },
    systemSettings: null,
    users: []
  },
  registration: {
    inviteRequired: false
  },
  systemSettings: {
    captcha: {
      yescaptchaEndpoint: "https://api.yescaptcha.com",
      hasYescaptchaKey: false,
      yescaptchaKeyMasked: "",
      autoSolveEnabled: false,
      visionFallbackEnabled: true,
      visionFallbackAccountId: null,
      maxRetries: 3,
      cooldownMs: 60000
    },
    inputContentLimit: 160000,
    chainOfThoughtOverrideEnabled: false,
    toolParsingModeEnabled: false
  },
  selectedAccountId: "",
  selectedSessionId: "",
  currentMessageId: null,
  sessions: [],
  messages: [],
  requestLogs: [],
  usageStats: { totalTokens: 0, promptTokens: 0, completionTokens: 0, requests: 0, byPath: {} },
  draftFiles: [],
  isSending: false,
  discoveredPaths: []
});

export const ELEMENT_IDS = [
  "account-form", "account-list", "account-password", "account-raw-json", "account-select", "account-status", "account-username",
  "check-accounts-button",
  "active-theme-label", "admin-invite-form", "admin-invite-count", "admin-invite-list",
  "admin-invite-status", "admin-register-hint", "admin-registration-form", "admin-registration-status",
  "admin-user-list", "admin-user-status", "api-key-count", "api-key-form", "api-key-label", "api-key-output",
  "api-key-plain", "api-key-tool-calls", "api-keys", "app-status", "app-view", "attach-files", "chat-status",
  "captcha-alert-list", "cot-override-description", "cot-override-form", "cot-override-label",
  "cot-override-status", "cot-override-toggle", "dashboard-health-cards", "dashboard-recent-logs", "dashboard-request-chart",
  "delete-selected-invites", "delete-selected-users", "disable-selected-users", "draft-files", "enable-selected-users",
  "endpoint-count", "explorer-body", "explorer-form", "explorer-method", "explorer-output", "explorer-path",
  "explorer-query", "file-input", "incognito-description", "incognito-form",
  "incognito-label", "incognito-status", "incognito-summary", "incognito-toggle", "invite-required-toggle",
  "login-form", "login-password", "login-status", "login-username", "login-view", "logout-button", "message-count",
  "messages", "metric-session-count", "model-select", "new-session", "prompt-input", "refresh-sessions", "toggle-sidebar", "register-form",
  "register-invite-code", "register-invite-group", "register-password", "register-status", "register-username",
  "refresh-request-logs", "request-log-list", "response-mode", "role-label", "send-button", "session-caption", "session-count", "sessions",
  "settings-auto-solve", "settings-clear-yescaptcha-key", "settings-cooldown-ms", "settings-endpoint",
  "settings-form", "settings-input-content-limit", "settings-max-retries", "settings-origin", "settings-registration-summary",
  "settings-status", "settings-vision-fallback", "settings-vision-account", "settings-cot-override",
  "settings-tool-parsing-mode", "settings-yescaptcha-key",
  "shared-mode-description", "shared-mode-form", "shared-mode-label", "shared-mode-panel",
  "shared-mode-status", "shared-mode-summary", "shared-mode-toggle", "tab-admin", "user-summary",
  "tool-parsing-description", "tool-parsing-form", "tool-parsing-label", "tool-parsing-status",
  "tool-parsing-toggle"
];
