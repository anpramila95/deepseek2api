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

function renderSessionMarkup({ selectedSessionId, selectedSessionIds }) {
  return (session) => {
    const isActive = session.id === selectedSessionId;
    const isSelected = selectedSessionIds.has(session.id);
    const title = escapeHtml(session.title || "Phiên chưa đặt tên");
    const model = escapeHtml(session.model_type || "default");
    const updatedAt = escapeHtml(formatTimestamp(session.updated_at));
    const sessionId = escapeHtml(session.id);

    return `
      <div class="session-row ${isActive ? "active" : ""} ${isSelected ? "selected" : ""}" data-session-id="${sessionId}">
        <label class="session-checkbox">
          <input
            type="checkbox"
            data-session-select="${sessionId}"
            ${isSelected ? "checked" : ""}
            aria-label="Chọn phiên"
          />
        </label>
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
      </div>
    `;
  };
}

export function renderSessionList(options) {
  const {
    container,
    onSelect,
    onToggleSelect,
    onSelectAll,
    onDeleteSelected,
    selectedSessionId,
    selectedSessionIds,
    sessions
  } = options;
  const selectedSet = new Set(selectedSessionIds || []);
  const allSelected = sessions.length > 0 && sessions.every((session) => selectedSet.has(session.id));

  const toolbar = `
    <div class="session-toolbar">
      <label class="session-select-all">
        <input
          type="checkbox"
          data-session-select-all
          ${allSelected ? "checked" : ""}
          aria-label="Chọn tất cả"
        />
        <span>Chọn tất cả</span>
      </label>
      <button
        type="button"
        class="button-ghost button-danger"
        data-session-delete-selected
      >
        Xóa (${selectedSet.size})
      </button>
    </div>
  `;

  container.innerHTML = sessions.length
    ? toolbar + sessions.map(renderSessionMarkup({ selectedSessionId, selectedSessionIds: selectedSet })).join("")
    : createEmptyState("Chưa có phiên", "Tạo phiên mới để bắt đầu.");

  container.querySelectorAll("[data-session-id]").forEach((row) => {
    const button = row.querySelector("button.session-item");
    if (button) {
      button.onclick = () => onSelect(button.dataset.sessionId);
    }
  });

  container.querySelectorAll("[data-session-select]").forEach((checkbox) => {
    checkbox.onchange = () => onToggleSelect(checkbox.dataset.sessionSelect);
  });

  const selectAll = container.querySelector("[data-session-select-all]");
  if (selectAll) {
    selectAll.onchange = () => onSelectAll();
  }

  const deleteSelected = container.querySelector("[data-session-delete-selected]");
  if (deleteSelected) {
    deleteSelected.onclick = async () => {
      const selectedIds = [...selectedSet];
      if (!selectedIds.length) {
        window.alert("Vui lòng chọn phiên cần xóa.");
        return;
      }

      if (!window.confirm(`Xác nhận xóa ${selectedIds.length} phiên đã chọn?`)) {
        return;
      }

      const originalText = deleteSelected.textContent;
      deleteSelected.disabled = true;
      deleteSelected.textContent = "Đang xóa...";
      try {
        await onDeleteSelected(selectedIds);
      } finally {
        if (deleteSelected.isConnected) {
          deleteSelected.disabled = false;
          deleteSelected.textContent = originalText;
        }
      }
    };
  }
}
