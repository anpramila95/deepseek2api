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

function renderAccountMeta(account, isAdmin) {
  const detail = resolveAccountDetail(account);
  const owner = isAdmin ? formatOwner(account.ownerId) : "";
  return [detail, owner].filter(Boolean).join(" | ");
}

function renderStatusText(account, selectedAccountId) {
  const isSelected = account.id === selectedAccountId;
  const isCaptcha = account.status === "captcha_required" || Boolean(account.captchaState?.triggered);
  const isDead = account.status === "offline" || isCaptcha;

  if (isDead) {
    return { text: "Không hoạt động", className: "chip chip-danger" };
  }

  if (isSelected) {
    return { text: "Đang chọn", className: "chip chip-primary" };
  }

  return { text: "Sẵn sàng", className: "chip chip-success" };
}

function resolveHealth(account) {
  if (account.captchaState?.triggered || account.status === "captcha_required") {
    return { className: "danger", label: "Yêu cầu captcha" };
  }

  if (!account.status || account.status === "online") {
    return account.settingsReported && account.dataOptimizationDisabled
      ? { className: "ok", label: "Hoạt động tốt" }
      : { className: "warn", label: "Chờ xác nhận cài đặt" };
  }

  if (account.status === "rate_limited") {
    return { className: "warn", label: "Giới hạn tần suất" };
  }

  return { className: "danger", label: "Không hoạt động" };
}

function renderCaptchaPanel(account) {
  const state = account.captchaState ?? {};
  if (!state.triggered) {
    return "";
  }

  return `
    <div class="captcha-panel">
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
        <button type="submit" class="button-primary" data-ripple>Gửi</button>
        <button type="button" class="button-secondary" data-captcha-retry="${escapeHtml(account.id)}" data-ripple>Tự động thử lại</button>
        <button type="button" class="button-ghost" data-captcha-clear="${escapeHtml(account.id)}" data-ripple>Bỏ qua</button>
      </form>
    </div>
  `;
}

function renderCheckButton(accountId) {
  return `
    <button
      type="button"
      class="button-ghost"
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
      class="button-ghost button-danger"
      data-account-delete-id="${escapeHtml(accountId)}"
      data-ripple
    >
      Xóa
    </button>
  `;
}

function renderAccountItem(account, options) {
  const { isAdmin, selectedAccountId } = options;
  const meta = renderAccountMeta(account, isAdmin);
  const selectedClass = account.id === selectedAccountId ? " active" : "";
  const health = resolveHealth(account);

  const statusBadge = renderStatusText(account, selectedAccountId);

  return `
    <article class="account-item${selectedClass} account-health-${health.className}">
      <div class="account-info">
        <div class="account-title-row">
          <span class="health-dot ${health.className}"></span>
          <strong>${escapeHtml(resolveAccountLabel(account))}</strong>
        </div>
        <span class="account-meta">${escapeHtml(meta)}</span>
        <span class="account-meta">Trạng thái: ${escapeHtml(health.label)} · Tối ưu dữ liệu: ${account.dataOptimizationDisabled ? "Đã tắt" : "Chưa xác nhận"} · Settings: ${account.settingsReported ? "Đã báo cáo" : "Chưa báo cáo"} · Cập nhật: ${escapeHtml(formatDateTime(account.updatedAt))}</span>
      </div>
      <div class="inline-actions account-actions">
        <span class="${escapeHtml(statusBadge.className)}">${escapeHtml(statusBadge.text)}</span>
        ${renderCheckButton(account.id)}
        ${renderDeleteButton(account.id)}
      </div>
      ${renderCaptchaPanel(account)}
    </article>
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
    ? accounts
      .map((account) => renderAccountItem(account, { isAdmin, selectedAccountId }))
      .join("")
    : createEmptyState("Chưa có tài khoản", "Vui lòng liên kết một tài khoản trước.");

  bindDeleteActions(container, accounts, onDeleteAccount);
}
