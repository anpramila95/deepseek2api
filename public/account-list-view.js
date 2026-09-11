import { resolveAccountDetail, resolveAccountLabel } from "/account-display.js";
import { createEmptyState, escapeHtml } from "/utils.js";

function formatOwner(ownerId) {
  return ownerId === "admin" ? "Quản trị viên" : ownerId;
}

function formatDateTime(value) {
  if (!value) {
    return "Chưa ghi nhận";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function resolveHealth(account) {
  if (account.status === "banned" || account.status === "disabled") {
    return { className: "danger", label: "Đã bị khóa / Banned", badgeClass: "chip chip-danger" };
  }

  if (account.rateLimitedAt) {
    const elapsed = Date.now() - Date.parse(account.rateLimitedAt);
    const cooldownMs = 3_600_000;
    if (Number.isFinite(elapsed) && elapsed < cooldownMs) {
      const remainingMin = Math.ceil((cooldownMs - elapsed) / 60_000);
      return {
        className: "warn",
        label: `Bị 429 (còn ${remainingMin} phút)`,
        badgeClass: "chip chip-warn",
        rateLimited: true
      };
    }
  }

  if (account.captchaState?.triggered || account.status === "captcha_required") {
    return { className: "danger", label: "Yêu cầu Captcha", badgeClass: "chip chip-danger" };
  }

  if (!account.status || account.status === "online") {
    return account.settingsReported && account.dataOptimizationDisabled
      ? { className: "ok", label: "Hoạt động tốt", badgeClass: "chip chip-success" }
      : { className: "warn", label: "Chờ xác nhận", badgeClass: "chip chip-warn" };
  }

  return { className: "danger", label: "Không hoạt động", badgeClass: "chip chip-danger" };
}

function renderStatusBadge(account, selectedAccountId, health) {
  if (account.id === selectedAccountId) {
    return `<span class="chip chip-primary">Đang chọn</span>`;
  }
  return `<span class="${escapeHtml(health.badgeClass)}">${escapeHtml(health.label)}</span>`;
}

function renderCheckButton(accountId) {
  return `
    <button
      type="button"
      class="button-ghost button-small"
      data-account-check-id="${escapeHtml(accountId)}"
      data-ripple
    >
      Kiểm tra
    </button>
  `;
}

function renderDeleteButton(accountId) {
  return `
    <button
      type="button"
      class="button-ghost button-danger button-small"
      data-account-delete-id="${escapeHtml(accountId)}"
      data-ripple
    >
      Xóa
    </button>
  `;
}

function renderCaptchaPanel(account) {
  const state = account.captchaState ?? {};
  if (!state.triggered) {
    return "";
  }

  return `
    <div class="captcha-panel mt-2">
      <div class="captcha-copy">
        <strong>Chờ xử lý CAPTCHA</strong>
        <span>${escapeHtml(state.instruction || "Chưa nhận được hướng dẫn, vui lòng hoàn thành xác minh thủ công rồi nhập rid.")}</span>
        <span class="muted">Thời gian kích hoạt: ${escapeHtml(formatDateTime(state.triggerTime))}</span>
        ${state.lastError ? `<span class="captcha-error">${escapeHtml(state.lastError)}</span>` : ""}
      </div>
      ${state.imageUrl ? `<img class="captcha-preview" src="${escapeHtml(state.imageUrl)}" alt="Hình ảnh CAPTCHA">` : ""}
      <form class="captcha-form" data-captcha-form="${escapeHtml(account.id)}">
        <label class="input-group compact-field"><span>Tọa độ</span><input data-captcha-coordinates placeholder="Ví dụ: 320,145"></label>
        <label class="input-group compact-field"><span>rid</span><input data-captcha-rid placeholder="rid sau khi xác minh"></label>
        <button type="submit" class="button-primary button-small" data-ripple>Gửi</button>
        <button type="button" class="button-secondary button-small" data-captcha-retry="${escapeHtml(account.id)}" data-ripple>Thử lại</button>
        <button type="button" class="button-ghost button-small" data-captcha-clear="${escapeHtml(account.id)}" data-ripple>Bỏ qua</button>
      </form>
    </div>
  `;
}

function renderAccountTable(accounts, options) {
  const { isAdmin, selectedAccountId } = options;

  const rows = accounts.map((account, index) => {
    const health = resolveHealth(account);
    const label = resolveAccountLabel(account);
    const detail = resolveAccountDetail(account);
    const owner = isAdmin ? formatOwner(account.ownerId) : "";
    const isSelected = account.id === selectedAccountId;
    const rowClass = isSelected ? " selected-row" : "";

    let logMessage = "";
    if (account.rateLimitedAt) {
      logMessage = `<div class="account-log-danger">429 Lúc: ${escapeHtml(formatDateTime(account.rateLimitedAt))}</div>`;
    } else if (account.captchaState?.triggered) {
      logMessage = `<div class="account-log-warn">Captcha Lúc: ${escapeHtml(formatDateTime(account.captchaState.triggerTime))}</div>`;
    } else if (account.lastError) {
      logMessage = `<div class="account-log-danger">${escapeHtml(account.lastError)}</div>`;
    } else {
      logMessage = `<span class="muted">Bình thường</span>`;
    }

    return `
      <tr class="account-row${rowClass}">
        <td class="text-center font-mono font-bold">${index + 1}</td>
        <td>
          <div class="account-name-cell">
            <span class="health-dot ${health.className}"></span>
            <strong>${escapeHtml(label)}</strong>
          </div>
          ${detail && detail !== label ? `<small class="muted block">${escapeHtml(detail)}</small>` : ""}
        </td>
        <td>
          ${renderStatusBadge(account, selectedAccountId, health)}
        </td>
        <td>
          <div class="account-log-cell">
            ${logMessage}
            ${renderCaptchaPanel(account)}
          </div>
        </td>
        <td>
          <small class="muted block">Proxy: ${account.proxyConfigured ? "Đã gắn" : "Không"}</small>
          <small class="muted block">Cập nhật: ${escapeHtml(formatDateTime(account.updatedAt))}</small>
          ${owner ? `<small class="muted block">${escapeHtml(owner)}</small>` : ""}
        </td>
        <td class="text-right">
          <div class="inline-actions">
            ${renderCheckButton(account.id)}
            ${renderDeleteButton(account.id)}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  return `
    <div class="table-responsive">
      <table class="data-table accounts-table">
        <thead>
          <tr>
            <th class="text-center" style="width: 50px;">STT</th>
            <th>Tài khoản</th>
            <th style="width: 150px;">Trạng thái</th>
            <th>Chi tiết Log / Lỗi</th>
            <th style="width: 170px;">Thông tin</th>
            <th class="text-right" style="width: 140px;">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function resolveAccount(accounts, accountId) {
  const account = accounts.find((entry) => entry.id === accountId);
  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  return account;
}

function bindDeleteActions(container, accounts, onDeleteAccount) {
  container.querySelectorAll("[data-account-delete-id]").forEach((button) => {
    button.onclick = async () => {
      const accountId = button.dataset.accountDeleteId;
      const account = resolveAccount(accounts, accountId);
      const label = resolveAccountLabel(account) || account.id;
      if (!window.confirm(`Xác nhận xóa tài khoản liên kết "${label}"?`)) {
        return;
      }

      await onDeleteAccount(account.id);
    };
  });
}

export function renderAccountListView(options) {
  const {
    accounts,
    container,
    isAdmin,
    onDeleteAccount,
    selectedAccountId
  } = options;

  container.innerHTML = accounts.length
    ? renderAccountTable(accounts, { isAdmin, selectedAccountId })
    : createEmptyState("Chưa có tài khoản", "Vui lòng liên kết một tài khoản trước.");

  bindDeleteActions(container, accounts, onDeleteAccount);
}
