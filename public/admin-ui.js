import { createEmptyState, escapeHtml } from "/utils.js";

function formatTimestamp(value) {
  if (!value) {
    return "Chưa dùng";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatLimitValue(value, unit) {
  return value === null ? `Không giới hạn ${unit}` : `${value} ${unit}`;
}

function renderInviteMeta(invite) {
  if (!invite.usedAt) {
    return `Chưa dùng · ${formatTimestamp(invite.createdAt)}`;
  }

  return `${invite.usedByUsername || "Người dùng không xác định"} · ${formatTimestamp(invite.usedAt)}`;
}

function renderInviteItem(invite) {
  return `
    <article class="admin-list-item">
      <label class="admin-select">
        <input type="checkbox" data-invite-select value="${escapeHtml(invite.id)}">
        <span>Chọn</span>
      </label>
      <div class="admin-list-copy">
        <strong>${escapeHtml(invite.code)}</strong>
        <span>${escapeHtml(renderInviteMeta(invite))}</span>
      </div>
      <div class="inline-actions">
        <span class="chip">${invite.usedAt ? "Đã dùng" : "Khả dụng"}</span>
        <button type="button" class="button-ghost button-danger" data-invite-delete="${escapeHtml(invite.id)}" data-ripple>Xóa</button>
      </div>
    </article>
  `;
}

function buildUserMeta(user) {
  return [
    user.disabled ? "Đã vô hiệu" : "Bình thường",
    `Tài khoản ${user.accountCount}`,
    `Khóa API ${user.apiKeyCount}`,
    formatLimitValue(user.requestLimits.maxConcurrency, "đồng thời"),
    formatLimitValue(user.requestLimits.maxRequestsPerMinute, "/phút")
  ].join(" · ");
}

function renderUserItem(user) {
  const concurrencyValue = user.requestLimits.maxConcurrency ?? "";
  const rateValue = user.requestLimits.maxRequestsPerMinute ?? "";

  return `
    <article class="admin-list-item admin-user-item">
      <label class="admin-select">
        <input type="checkbox" data-user-select value="${escapeHtml(user.id)}">
        <span>Chọn</span>
      </label>
      <div class="admin-list-copy">
        <strong>${escapeHtml(user.username)}</strong>
        <span>${escapeHtml(buildUserMeta(user))}</span>
      </div>
      <form class="admin-user-form" data-user-form="${escapeHtml(user.id)}">
        <label class="input-group compact-field">
          <span>Đồng thời</span>
          <input type="number" min="1" step="1" data-limit-field="maxConcurrency" value="${escapeHtml(concurrencyValue)}" placeholder="Không giới hạn">
        </label>
        <label class="input-group compact-field">
          <span>Tốc độ</span>
          <input type="number" min="1" step="1" data-limit-field="maxRequestsPerMinute" value="${escapeHtml(rateValue)}" placeholder="Không giới hạn">
        </label>
        <div class="inline-actions">
          <button type="submit" class="button-primary" data-ripple>Lưu</button>
          <button type="button" class="button-secondary" data-user-toggle-disable="${escapeHtml(user.id)}" data-disabled="${escapeHtml(String(user.disabled))}" data-ripple>${user.disabled ? "Bật" : "Tắt"}</button>
          <button type="button" class="button-ghost button-danger" data-user-delete="${escapeHtml(user.id)}" data-ripple>Xóa</button>
        </div>
      </form>
    </article>
  `;
}

export function renderInviteList(container, invites) {
  container.innerHTML = invites.length
    ? invites.map(renderInviteItem).join("")
    : createEmptyState("Chưa có mã mời", "Mã mời được tạo sẽ hiển thị ở đây.");
}

export function renderUserList(container, users) {
  container.innerHTML = users.length
    ? users.map(renderUserItem).join("")
    : createEmptyState("Chưa có người dùng", "Người dùng đăng ký sẽ hiển thị ở đây.");
}
