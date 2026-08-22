import { createEmptyState, escapeHtml } from "/utils.js";

function formatTimestamp(value) {
  if (!value) {
    return "Vừa xong";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  }).format(new Date(value * 1000));
}

function renderSessionMarkup(selectedSessionId) {
  return (session) => {
    const isActive = session.id === selectedSessionId;
    const title = escapeHtml(session.title || "Phiên chưa đặt tên");
    const model = escapeHtml(session.model_type || "default");
    const updatedAt = escapeHtml(formatTimestamp(session.updated_at));
    const sessionId = escapeHtml(session.id);

    return `
      <button
        type="button"
        class="session-item ${isActive ? "active" : ""}"
        data-session-id="${sessionId}"
        data-ripple
      >
        <div class="session-item-title">${title}</div>
        <div class="session-meta">
          <span class="chip">${model}</span>
          <span class="session-time">${updatedAt}</span>
        </div>
      </button>
    `;
  };
}

export function renderSessionList(options) {
  const { container, onSelect, selectedSessionId, sessions } = options;
  container.innerHTML = sessions.length
    ? sessions.map(renderSessionMarkup(selectedSessionId)).join("")
    : createEmptyState("Chưa có phiên", "Tạo phiên mới để bắt đầu.");

  container.querySelectorAll("[data-session-id]").forEach((button) => {
    button.onclick = () => onSelect(button.dataset.sessionId);
  });
}
