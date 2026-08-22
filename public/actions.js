import { bindAdminActions } from "/admin-actions.js";

function bindAuthActions({ els, onLogin, onRegister, setStatus }) {
  els["login-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["login-status"], "Đang đăng nhập...");

    try {
      await onLogin({
        password: els["login-password"].value,
        username: els["login-username"].value.trim()
      });
      setStatus(els["login-status"], "");
    } catch (error) {
      setStatus(els["login-status"], error.message);
    }
  };

  els["register-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["register-status"], "Đang đăng ký...");

    try {
      await onRegister({
        inviteCode: els["register-invite-code"].value.trim(),
        password: els["register-password"].value,
        username: els["register-username"].value.trim()
      });
      setStatus(els["register-status"], "");
    } catch (error) {
      setStatus(els["register-status"], error.message);
    }
  };
}

function bindWorkspaceActions({
  els,
  onAccountChange,
  onAddAccount,
  onCheckAccounts,
  onClearCaptcha,
  onLogout,
  onResolveCaptcha,
  onRetryCaptcha,
  onToggleIncognito,
  onToggleSharedAccountMode,
  onToggleToolParsingMode,
  setStatus
}) {
  els["logout-button"].onclick = async () => {
    setStatus(els["app-status"], "");

    try {
      await onLogout();
    } catch (error) {
      setStatus(els["app-status"], error.message);
    }
  };

  els["account-select"].onchange = async () => {
    try {
      await onAccountChange(els["account-select"].value);
    } catch (error) {
      setStatus(els["app-status"], error.message);
    }
  };

  els["account-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["account-status"], "Đang liên kết...");

    const username = els["account-username"]?.value.trim() ?? "";
    const password = els["account-password"]?.value ?? "";
    const rawJson = els["account-raw-json"]?.value.trim() ?? "";

    try {
      await onAddAccount({
        password,
        username,
        rawJson
      });
      if (els["account-username"]) els["account-username"].value = "";
      if (els["account-password"]) els["account-password"].value = "";
      if (els["account-raw-json"]) els["account-raw-json"].value = "";
      setStatus(els["account-status"], "Đã liên kết.");
    } catch (error) {
      setStatus(els["account-status"], error.message);
    }
  };

  const accountCard = document.getElementById("account-binding-card");
  if (accountCard) {
    accountCard.addEventListener("click", (event) => {
      const modeBtn = event.target.closest("[data-import-mode]");
      if (!modeBtn) return;

      const mode = modeBtn.dataset.importMode;
      accountCard.querySelectorAll("[data-import-mode]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.importMode === mode);
      });

      const paneForm = document.getElementById("import-pane-form");
      const paneJson = document.getElementById("import-pane-json");
      if (paneForm && paneJson) {
        if (mode === "json") {
          paneForm.classList.add("hidden");
          paneJson.classList.remove("hidden");
        } else {
          paneForm.classList.remove("hidden");
          paneJson.classList.add("hidden");
        }
      }
    });
  }

  els["incognito-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["incognito-status"], "Đang lưu...");

    try {
      await onToggleIncognito(els["incognito-toggle"].checked);
      setStatus(els["incognito-status"], "Đã lưu.");
    } catch (error) {
      setStatus(els["incognito-status"], error.message);
    }
  };

  els["shared-mode-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["shared-mode-status"], "Đang lưu...");

    try {
      await onToggleSharedAccountMode(els["shared-mode-toggle"].checked);
      setStatus(els["shared-mode-status"], "Đã lưu.");
    } catch (error) {
      setStatus(els["shared-mode-status"], error.message);
    }
  };

  els["tool-parsing-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["tool-parsing-status"], "Đang lưu...");

    try {
      await onToggleToolParsingMode(els["tool-parsing-toggle"].checked);
      setStatus(els["tool-parsing-status"], "Đã lưu.");
    } catch (error) {
      setStatus(els["tool-parsing-status"], error.message);
    }
  };

  if (els["check-accounts-button"]) {
    els["check-accounts-button"].onclick = async () => {
      setStatus(els["account-status"], "Đang kiểm tra tất cả tài khoản...");
      try {
        await onCheckAccounts();
        setStatus(els["account-status"], "Đã kiểm tra xong tất cả tài khoản.");
      } catch (error) {
        setStatus(els["account-status"], error.message);
      }
    };
  }

  els["account-list"].addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-captcha-form]");
    if (!form) {
      return;
    }

    event.preventDefault();
    setStatus(els["account-status"], "Đang gửi kết quả CAPTCHA...");

    try {
      await onResolveCaptcha(form.dataset.captchaForm, {
        rid: form.querySelector("[data-captcha-rid]")?.value.trim() ?? "",
        coordinateText: form.querySelector("[data-captcha-coordinates]")?.value.trim() ?? ""
      });
      setStatus(els["account-status"], "Đã cập nhật trạng thái CAPTCHA.");
    } catch (error) {
      setStatus(els["account-status"], error.message);
    }
  });

  els["account-list"].addEventListener("click", async (event) => {
    const checkButton = event.target.closest("[data-account-check-id]");
    if (checkButton) {
      const accountId = checkButton.dataset.accountCheckId;
      setStatus(els["account-status"], "Đang kiểm tra tài khoản...");
      try {
        await onCheckAccounts(accountId);
        setStatus(els["account-status"], "Đã kiểm tra xong tài khoản.");
      } catch (error) {
        setStatus(els["account-status"], error.message);
      }
      return;
    }

    const retryButton = event.target.closest("[data-captcha-retry]");
    const clearButton = event.target.closest("[data-captcha-clear]");
    const accountId = retryButton?.dataset.captchaRetry || clearButton?.dataset.captchaClear;
    if (!accountId) {
      return;
    }

    setStatus(els["account-status"], retryButton ? "Đang tự động xử lý CAPTCHA..." : "Đang dọn dẹp trạng thái CAPTCHA...");

    try {
      if (retryButton) {
        await onRetryCaptcha(accountId);
      } else {
        await onClearCaptcha(accountId);
      }
      setStatus(els["account-status"], "Đã cập nhật trạng thái CAPTCHA.");
    } catch (error) {
      setStatus(els["account-status"], error.message);
    }
  });
}

function bindChainOfThoughtOverrideAction({ els, onToggleChainOfThoughtOverride, setStatus }) {
  els["cot-override-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["cot-override-status"], "Đang lưu...");

    try {
      await onToggleChainOfThoughtOverride(els["cot-override-toggle"].checked);
      setStatus(els["cot-override-status"], "Đã lưu.");
    } catch (error) {
      setStatus(els["cot-override-status"], error.message);
    }
  };
}

function bindSessionActions({ els, onCreateSession, onRefreshSessions, setStatus }) {
  els["refresh-sessions"].onclick = async () => {
    setStatus(els["app-status"], "");

    try {
      await onRefreshSessions();
    } catch (error) {
      setStatus(els["app-status"], error.message);
    }
  };

  els["new-session"].onclick = async () => {
    setStatus(els["app-status"], "");

    try {
      await onCreateSession();
    } catch (error) {
      setStatus(els["app-status"], error.message);
    }
  };
}

function bindUploadActions({ els, onUploadFiles, setStatus }) {
  els["attach-files"].onclick = () => {
    els["file-input"].click();
  };

  els["file-input"].onchange = async () => {
    const files = Array.from(els["file-input"].files ?? []);
    if (!files.length) {
      return;
    }

    setStatus(els["chat-status"], "");
    try {
      await onUploadFiles(files);
    } catch (error) {
      setStatus(els["chat-status"], error.message);
    } finally {
      els["file-input"].value = "";
    }
  };
}

function bindComposerActions({ els, onSendPrompt, setStatus }) {
  els["send-button"].onclick = async () => {
    setStatus(els["chat-status"], "");

    try {
      await onSendPrompt();
    } catch (error) {
      setStatus(els["chat-status"], error.message);
    }
  };

  els["prompt-input"].onkeydown = async (event) => {
    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) {
      return;
    }

    event.preventDefault();
    await els["send-button"].onclick();
  };
}

function bindFormActions({ els, onExplorerSubmit, onRefreshRequestLogs, onSubmitApiKey, setStatus }) {
  if (els["refresh-request-logs"]) {
    els["refresh-request-logs"].onclick = async () => {
      setStatus(els["explorer-output"], "");
      try {
        await onRefreshRequestLogs();
      } catch (error) {
        setStatus(els["explorer-output"], error.message);
      }
    };
  }

  els["api-key-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["api-key-output"], "");

    try {
      await onSubmitApiKey({
        label: els["api-key-label"].value.trim(),
        plainKey: els["api-key-plain"].value.trim(),
        toolCallsEnabled: els["api-key-tool-calls"].checked
      });
    } catch (error) {
      setStatus(els["api-key-output"], error.message);
    }
  };

  els["explorer-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["explorer-output"], "");

    try {
      await onExplorerSubmit({
        bodyText: els["explorer-body"].value.trim(),
        method: els["explorer-method"].value,
        path: els["explorer-path"].value,
        queryText: els["explorer-query"].value.trim()
      });
    } catch (error) {
      setStatus(els["explorer-output"], error.message);
    }
  };
}

function bindSystemSettingsActions({ els, onUpdateSystemSettings, setStatus }) {
  if (!els["settings-form"]) {
    return;
  }

  els["settings-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["settings-status"], "Đang lưu...");

    try {
      await onUpdateSystemSettings({
        captcha: {
          yescaptchaEndpoint: els["settings-endpoint"].value.trim(),
          ...(els["settings-yescaptcha-key"].value.trim() || els["settings-clear-yescaptcha-key"].checked
            ? { yescaptchaKey: els["settings-clear-yescaptcha-key"].checked ? "" : els["settings-yescaptcha-key"].value.trim() }
            : {}),
          autoSolveEnabled: els["settings-auto-solve"].checked,
          visionFallbackEnabled: els["settings-vision-fallback"].checked,
          visionFallbackAccountId: els["settings-vision-account"].value || null,
          maxRetries: els["settings-max-retries"].value,
          cooldownMs: els["settings-cooldown-ms"].value
        },
        inputContentLimit: els["settings-input-content-limit"].value,
        chainOfThoughtOverrideEnabled: els["settings-cot-override"].checked,
        toolParsingModeEnabled: els["settings-tool-parsing-mode"].checked
      });
      els["settings-yescaptcha-key"].value = "";
      els["settings-clear-yescaptcha-key"].checked = false;
      setStatus(els["settings-status"], "Đã lưu cài đặt hệ thống.");
    } catch (error) {
      setStatus(els["settings-status"], error.message);
    }
  };
}

export function bindActions(options) {
  bindAuthActions(options);
  bindWorkspaceActions(options);
  bindChainOfThoughtOverrideAction(options);
  bindSessionActions(options);
  bindUploadActions(options);
  bindComposerActions(options);
  bindFormActions(options);
  bindSystemSettingsActions(options);
  bindAdminActions(options);
}
