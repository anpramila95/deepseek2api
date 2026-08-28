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
  onBatchImportAccounts,
  onExportAccounts,
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

    const activeModeBtn = document.querySelector("#account-binding-card [data-import-mode].active");
    const mode = activeModeBtn?.dataset.importMode || "form";

    if (mode === "batch") {
      const rawText = els["account-batch-text"]?.value.trim() ?? "";
      if (!rawText) {
        setStatus(els["account-status"], "Vui lòng nhập nội dung hoặc tải lên file danh sách tài khoản.");
        return;
      }
      setStatus(els["account-status"], "Đang xử lý nhập hàng loạt...");
      try {
        const result = await onBatchImportAccounts({ rawText });
        const errorInfo = result.errors?.length ? ` (${result.errors.length} lỗi)` : "";
        setStatus(
          els["account-status"],
          `Nhập hoàn tất: Thành công ${result.imported}/${result.total}${errorInfo}.`
        );
      } catch (error) {
        setStatus(els["account-status"], error.message);
      }
      return;
    }

    setStatus(els["account-status"], "Đang liên kết...");

    const username = els["account-username"]?.value.trim() ?? "";
    const password = els["account-password"]?.value ?? "";
    const rawJson = els["account-raw-json"]?.value.trim() ?? "";
    const proxy = els["account-proxy"]?.value.trim() || els["account-proxy-json"]?.value.trim() || "";

    try {
      await onAddAccount({
        password,
        username,
        rawJson,
        proxy
      });
      if (els["account-username"]) els["account-username"].value = "";
      if (els["account-password"]) els["account-password"].value = "";
      if (els["account-raw-json"]) els["account-raw-json"].value = "";
      if (els["account-proxy"]) els["account-proxy"].value = "";
      if (els["account-proxy-json"]) els["account-proxy-json"].value = "";
      setStatus(els["account-status"], "Đã liên kết.");
    } catch (error) {
      setStatus(els["account-status"], error.message);
    }
  };

  const fileInput = els["account-import-file"];
  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (els["account-import-file-name"]) {
        els["account-import-file-name"].textContent = `Đã chọn: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (els["account-batch-text"]) {
          els["account-batch-text"].value = evt.target.result;
        }
      };
      reader.readAsText(file);
    });
  }

  if (els["export-accounts-button"]) {
    els["export-accounts-button"].onclick = async () => {
      setStatus(els["account-status"], "Đang xuất dữ liệu...");
      try {
        const data = await onExportAccounts();
        const blob = new Blob([JSON.stringify(data.accounts, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const dateStr = new Date().toISOString().slice(0, 10);
        a.download = `deepseek-accounts-${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatus(els["account-status"], `Đã xuất ${data.accounts.length} tài khoản thành công.`);
      } catch (error) {
        setStatus(els["account-status"], `Xuất thất bại: ${error.message}`);
      }
    };
  }

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
      const paneBatch = document.getElementById("import-pane-batch");
      if (paneForm && paneJson && paneBatch) {
        paneForm.classList.toggle("hidden", mode !== "form");
        paneJson.classList.toggle("hidden", mode !== "json");
        paneBatch.classList.toggle("hidden", mode !== "batch");
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
  const sidebar = document.querySelector(".sidebar");
  const toggleSidebar = els["toggle-sidebar"];
  const sidebarCollapsed = localStorage.getItem("deepseek2api-sidebar-collapsed") === "true";

  const setSidebarCollapsed = (collapsed) => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    toggleSidebar.setAttribute("aria-expanded", String(!collapsed));
    toggleSidebar.title = collapsed ? "Mở sidebar" : "Thu gọn sidebar";
    toggleSidebar.setAttribute("aria-label", toggleSidebar.title);
    toggleSidebar.innerHTML = `<i data-lucide="panel-left-${collapsed ? "open" : "close"}"></i>`;
    window.lucide?.createIcons();
    localStorage.setItem("deepseek2api-sidebar-collapsed", String(collapsed));
  };

  setSidebarCollapsed(sidebarCollapsed);
  toggleSidebar.onclick = () => setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));

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

function bindDashboardActions({ els, onRenderDashboard }) {
  const rerender = () => {
    if (typeof onRenderDashboard === "function") {
      onRenderDashboard();
    }
  };

  if (els["trend-time-range"]) {
    els["trend-time-range"].onchange = rerender;
  }
  if (els["trend-model-filter"]) {
    els["trend-model-filter"].onchange = rerender;
  }
  if (els["trend-status-filter"]) {
    els["trend-status-filter"].onchange = rerender;
  }
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
        toolParsingModeEnabled: els["settings-tool-parsing-mode"].checked,
        globalProxies: els["settings-global-proxies"]?.value ?? ""
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
  bindDashboardActions(options);
  bindChainOfThoughtOverrideAction(options);
  bindSessionActions(options);
  bindUploadActions(options);
  bindComposerActions(options);
  bindFormActions(options);
  bindSystemSettingsActions(options);
  bindAdminActions(options);
}
