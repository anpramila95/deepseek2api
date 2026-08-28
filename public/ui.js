import { resolveAccountLabel } from "/account-display.js";
import { createEmptyState, escapeHtml } from "/utils.js";
const TAB_LABELS = Object.freeze({
  accounts: "Quản lý tài khoản",
  admin: "Quản lý người dùng",
  chat: "Khu vực làm việc trò chuyện",
  dashboard: "Trang tổng quan",
  explorer: "Giám sát nhật ký yêu cầu",
  keys: "Quản lý API Key",
  settings: "Cài đặt hệ thống"
});
const FILE_STATUS_LABELS = Object.freeze({
  FAILED: "Thất bại",
  PARSING: "Đang phân tích",
  PENDING: "Đang chờ",
  SUCCESS: "Hoàn thành",
  UPLOADING: "Đang tải lên"
});
function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function resolveFileStatus(file) {
  if (file.errorCode) {
    return `${FILE_STATUS_LABELS.FAILED} (${escapeHtml(file.errorCode)})`;
  }
  return FILE_STATUS_LABELS[file.status] ?? escapeHtml(file.status || "UNKNOWN");
}
function renderFileMarkup(file, options = {}) {
  const { deletable = false } = options;
  const deleteButton = deletable
    ? `
      <button
        type="button"
        class="button-ghost"
        data-draft-file-id="${escapeHtml(file.localId)}"
        data-ripple
      >
        Xóa
      </button>
    `
    : "";
  return `
    <article class="file-item ${escapeHtml(String(file.status || "").toLowerCase())}">
      <div class="file-info">
        <strong>${escapeHtml(file.fileName)}</strong>
        <span class="file-meta">${resolveFileStatus(file)} · ${escapeHtml(formatFileSize(file.fileSize))}</span>
      </div>
      ${deleteButton}
    </article>
  `;
}
function renderFileListMarkup(files, options = {}) {
  if (!files?.length) {
    return "";
  }

  const className = options.className ?? "file-list";
  return `
    <div class="${className}">
      ${files.map((file) => renderFileMarkup(file, options)).join("")}
    </div>
  `;
}
function formatDateTime(value) {
  if (!value) {
    return "Chưa ghi nhận";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function renderCopyIcon() {
  return '<i data-lucide="copy" aria-hidden="true"></i>';
}

function renderTrashIcon() {
  return '<i data-lucide="trash-2" aria-hidden="true"></i>';
}

async function copyText(value) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.left = "-9999px";
  textarea.style.position = "fixed";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

function renderApiKeyMarkup(key) {
  const checked = key.toolCallsEnabled ? " checked" : "";
  const toolLabel = key.toolCallsEnabled ? "Gọi công cụ: Bật" : "Gọi công cụ: Tắt";
  const copyValue = key.key || "";
  const copyTitle = copyValue ? "Sao chép API Key" : "Key cũ không thể sao chép giá trị đầy đủ";
  const copyAttributes = copyValue
    ? `title="${copyTitle}" aria-label="${copyTitle}" data-key-copy-id="${escapeHtml(key.id)}"`
    : `title="${copyTitle}" aria-label="${copyTitle}" disabled`;

  return `
    <article class="key-item api-key-card">
      <div class="key-card-secret">
        <code class="key-preview">${escapeHtml(key.preview)}</code>
        <div class="key-card-actions">
          <button
            type="button"
            class="icon-button"
            ${copyAttributes}
            data-ripple
          >
            ${renderCopyIcon()}
          </button>
        </div>
        <strong>${escapeHtml(key.label || "Key chưa đặt tên")}</strong>
        <span class="key-created">Tạo lúc ${escapeHtml(formatDateTime(key.createdAt))}</span>
      </div>
      <div class="key-card-meta">
        <span class="meta-label">Quyền mô hình</span>
        <span class="blue-pill">Tất cả mô hình</span>
      </div>
      <div class="key-card-meta">
        <span class="meta-label">Gọi công cụ</span>
        <label class="toggle-chip tool-pill">
          <input
            type="checkbox"
            data-key-tool-calls="${escapeHtml(key.id)}"
            ${checked}
          >
          <span>${escapeHtml(toolLabel)}</span>
        </label>
      </div>
      <div class="key-card-meta">
        <span class="meta-label">Sử dụng hôm nay</span>
        <strong class="usage-number">${escapeHtml(String(key.todayUsage ?? 0))}</strong><span> yêu cầu</span>
      </div>
      <div class="key-card-menu">
        <button
          type="button"
          class="icon-button"
          data-key-id="${escapeHtml(key.id)}"
          title="Xóa Key"
          aria-label="Xóa Key"
          data-ripple
        >
          ${renderTrashIcon()}
        </button>
      </div>
    </article>
  `;
}
function renderRequestLogMarkup(log) {
  const statusClass = Number(log.status) >= 400 ? "error" : "ok";
  return `
    <article class="request-log-row">
      <span>${escapeHtml(formatDateTime(log.at))}</span>
      <strong class="method-pill">${escapeHtml(log.method)}</strong>
      <code>${escapeHtml(log.path)}</code>
      <span>${escapeHtml(log.model || "-")}</span>
      <span class="status-dot ${statusClass}">${escapeHtml(log.status ?? "-")}</span>
      <span>${escapeHtml(Number.isFinite(log.durationMs) ? `${log.durationMs}ms` : "-")}</span>
      <span>${escapeHtml(log.error || "Bình thường")}</span>
    </article>
  `;
}
function renderRequestLogListMarkup(logs) {
  return `
    <div class="request-log-header">
      <span>Thời gian</span><span>Phương thức</span><span>Đường dẫn</span><span>Mô hình</span><span>Trạng thái</span><span>Thời gian</span><span>Kết quả</span>
    </div>
    ${logs.map(renderRequestLogMarkup).join("")}
  `;
}
function getAccountHealthCounts(accounts = []) {
  return accounts.reduce((counts, account) => {
    if (account.captchaState?.triggered || account.status === "captcha_required") {
      counts.captcha += 1;
    } else if (!account.status || account.status === "online") {
      counts.online += 1;
    } else {
      counts.offline += 1;
    }
    return counts;
  }, { captcha: 0, offline: 0, online: 0 });
}
function renderDashboardMetricCards(state) {
  const health = getAccountHealthCounts(state.accounts);
  const totalLogs = state.requestLogs.length;
  const failedLogs = state.requestLogs.filter((log) => Number(log.status) >= 400).length;
  const successRate = totalLogs ? Math.round(((totalLogs - failedLogs) / totalLogs) * 100) : 100;
  const latestLog = state.requestLogs[0];
  const usage = state.usageStats ?? {};
  const apiTypes = Object.entries(usage.byPath ?? {}).map(([path, count]) => `${path}: ${count}`).join(" · ") || "Chưa có dữ liệu";
  const cards = [
    ["Tài khoản khả dụng", health.online, `${health.captcha} captcha / ${health.offline} ngoại tuyến`, "ok"],
    ["API Key", state.apiKeys.length, "Số lượng key đã tạo", "info"],
    ["Tỷ lệ thành công", `${successRate}%`, `${totalLogs} yêu cầu gần đây`, failedLogs ? "warn" : "ok"],
    ["Yêu cầu mới nhất", latestLog?.status ?? "-", latestLog ? latestLog.path : "Chưa có yêu cầu", Number(latestLog?.status) >= 400 ? "danger" : "info"],
    ["Token đã dùng", Number(usage.totalTokens ?? 0).toLocaleString("vi-VN"), `${Number(usage.promptTokens ?? 0).toLocaleString("vi-VN")} input · ${Number(usage.completionTokens ?? 0).toLocaleString("vi-VN")} output`, "info"],
    ["Kiểu gọi API", Number(usage.requests ?? 0), apiTypes, "ok"]
  ];

  return cards.map(([label, value, detail, tone]) => `
    <article class="dashboard-card ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `).join("");
}
function buildRequestBuckets(logs, timeRange = "6h") {
  const now = Date.now();
  let count = 6;
  let bucketMs = 60 * 60 * 1000;
  let isDaily = false;

  if (timeRange === "24h") {
    count = 12;
    bucketMs = 2 * 60 * 60 * 1000;
  } else if (timeRange === "7d") {
    count = 7;
    bucketMs = 24 * 60 * 60 * 1000;
    isDaily = true;
  } else if (timeRange === "30d") {
    count = 15;
    bucketMs = 2 * 24 * 60 * 60 * 1000;
    isDaily = true;
  }

  return Array.from({ length: count }, (_, index) => {
    const start = now - (count - 1 - index) * bucketMs;
    const end = start + bucketMs;
    const entries = logs.filter((log) => {
      const time = Date.parse(log.at);
      return Number.isFinite(time) && time >= start && time < end;
    });

    const ok = entries.filter((log) => Number(log.status) < 400).length;
    const error = entries.filter((log) => Number(log.status) >= 400).length;
    const total = ok + error;
    const avgDuration = total ? Math.round(entries.reduce((acc, log) => acc + (log.durationMs || 0), 0) / total) : 0;

    let label;
    if (isDaily) {
      label = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(new Date(start));
    } else {
      label = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(start));
    }

    return {
      label,
      ok,
      error,
      total,
      avgDuration
    };
  });
}

function renderRequestChartMarkup(logs, options = {}) {
  const { timeRange = "6h", model = "all", status = "all" } = options;

  let filtered = logs;
  if (model && model !== "all") {
    filtered = filtered.filter((log) => (log.model || "").toLowerCase() === model.toLowerCase());
  }
  if (status === "ok") {
    filtered = filtered.filter((log) => Number(log.status) < 400);
  } else if (status === "error") {
    filtered = filtered.filter((log) => Number(log.status) >= 400);
  }

  const buckets = buildRequestBuckets(filtered, timeRange);
  const max = Math.max(1, ...buckets.map((bucket) => bucket.total));

  const totalReq = filtered.length;
  const okReq = filtered.filter((log) => Number(log.status) < 400).length;
  const errReq = filtered.filter((log) => Number(log.status) >= 400).length;
  const successRate = totalReq ? ((okReq / totalReq) * 100).toFixed(1) : "100.0";
  const avgLat = totalReq ? Math.round(filtered.reduce((acc, log) => acc + (log.durationMs || 0), 0) / totalReq) : 0;

  return `
    <div class="trend-stats-summary">
      <div class="trend-stat-item"><span class="stat-label">Tổng:</span><strong>${totalReq}</strong></div>
      <div class="trend-stat-item"><span class="stat-label">Thành công:</span><strong class="stat-ok">${okReq} (${successRate}%)</strong></div>
      <div class="trend-stat-item"><span class="stat-label">Lỗi:</span><strong class="stat-err">${errReq}</strong></div>
      <div class="trend-stat-item"><span class="stat-label">Độ trễ TB:</span><strong>${avgLat} ms</strong></div>
      <div class="trend-legend">
        <span class="legend-dot dot-ok"></span><span>Thành công</span>
        <span class="legend-dot dot-err"></span><span>Lỗi</span>
      </div>
    </div>
    <div class="dashboard-chart-bars">
      ${buckets.map((bucket) => {
        const height = Math.max(8, Math.round((bucket.total / max) * 100));
        const okPct = bucket.total ? (bucket.ok / bucket.total) * 100 : 0;
        const errPct = bucket.total ? (bucket.error / bucket.total) * 100 : 0;
        const tooltip = `${bucket.label}: ${bucket.total} yêu cầu (${bucket.ok} thành công, ${bucket.error} lỗi)${bucket.avgDuration ? ` - ${bucket.avgDuration}ms` : ""}`;
        return `
          <div class="chart-bucket" title="${escapeHtml(tooltip)}">
            <div class="chart-bar" style="height:${height}%">
              <span class="chart-bar-ok" style="height:${okPct}%"></span>
              <span class="chart-bar-error" style="height:${errPct}%"></span>
            </div>
            <span>${escapeHtml(bucket.label)}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}
function renderCaptchaAlerts(accounts) {
  const alerts = accounts.filter((account) => account.captchaState?.triggered);
  if (!alerts.length) {
    return createEmptyState("Không có cảnh báo CAPTCHA", "Tài khoản kích hoạt kiểm tra bảo mật sẽ hiển thị tại đây.");
  }

  return alerts.map((account) => `
    <article class="alert-row danger">
      <strong>${escapeHtml(resolveAccountLabel(account))}</strong>
      <span>${escapeHtml(account.captchaState?.instruction || "CAPTCHA đang chờ xử lý")}</span>
      <small>${escapeHtml(formatDateTime(account.captchaState?.triggerTime))}</small>
    </article>
  `).join("");
}
function createRipple({ event, target }) {
  const rect = target.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const ripple = document.createElement("span");
  ripple.className = "button-ripple";
  ripple.style.height = `${size}px`;
  ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
  ripple.style.width = `${size}px`;
  target.appendChild(ripple);
  window.setTimeout(() => ripple.remove(), 720);
}
export function setActiveTab(tab) {
  document.body.dataset.activeTab = tab;
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const isActive = button.dataset.tab === tab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  document.querySelectorAll(".tab-pane").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `tab-${tab}`);
  });
  document.dispatchEvent(new CustomEvent("apptabchange", { detail: { tab } }));
}
export function setupTabs() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.onclick = () => setActiveTab(button.dataset.tab);
  });
}
export function renderAccountOptions({ accounts, select, selectedAccountId }) {
  select.innerHTML = accounts.length
    ? accounts.map((account) => {
        const label = resolveAccountLabel(account);
        return `<option value="${escapeHtml(account.id)}">${escapeHtml(label)}</option>`;
      }).join("")
    : '<option value="">Chưa có tài khoản khả dụng</option>';
  select.value = selectedAccountId;
}
export function renderDraftFileList({ container, files, onDelete }) {
  container.innerHTML = renderFileListMarkup(files, {
    className: "draft-file-list",
    deletable: true
  });
  container.querySelectorAll("[data-draft-file-id]").forEach((button) => {
    button.onclick = () => onDelete(button.dataset.draftFileId);
  });
}
export function renderApiKeyList({ container, keys, onDelete, onToggleToolCalls }) {
  container.innerHTML = keys.length
    ? keys.map(renderApiKeyMarkup).join("")
    : createEmptyState("Chưa có API Key", "API Key sau khi tạo sẽ hiển thị tại đây.");
  const keyById = new Map(keys.map((key) => [key.id, key]));
  container.querySelectorAll("[data-key-copy-id]").forEach((button) => {
    button.onclick = async () => {
      const originalTitle = button.getAttribute("title") || "Sao chép API Key";
      const copyValue = keyById.get(button.dataset.keyCopyId)?.key;

      if (!copyValue) {
        return;
      }

      try {
        await copyText(copyValue);
        button.setAttribute("title", "Đã sao chép");
        button.setAttribute("aria-label", "Đã sao chép");
        window.setTimeout(() => {
          button.setAttribute("title", originalTitle);
          button.setAttribute("aria-label", originalTitle);
        }, 1200);
      } catch {
        button.setAttribute("title", "Sao chép thất bại");
        button.setAttribute("aria-label", "Sao chép thất bại");
      }
    };
  });
  container.querySelectorAll("[data-key-id]").forEach((button) => {
    button.onclick = () => onDelete(button.dataset.keyId);
  });
  container.querySelectorAll("[data-key-tool-calls]").forEach((input) => {
    input.onchange = async () => {
      try {
        await onToggleToolCalls(input.dataset.keyToolCalls, input.checked);
      } catch {
        input.checked = !input.checked;
      }
    };
  });
}
export function renderRequestLogList({ container, logs }) {
  container.innerHTML = logs?.length
    ? renderRequestLogListMarkup(logs)
    : createEmptyState("Chưa có nhật ký yêu cầu", "Nhật ký sau khi hoàn thành yêu cầu sẽ hiển thị tại đây.");
}
export function renderDashboardHome({ containers, state, filters = {} }) {
  containers.healthCards.innerHTML = renderDashboardMetricCards(state);

  if (containers.modelFilter) {
    const currentSelected = containers.modelFilter.value || "all";
    const uniqueModels = Array.from(new Set(state.requestLogs.map((l) => l.model).filter(Boolean)));
    const options = [
      '<option value="all">Tất cả mô hình</option>',
      ...uniqueModels.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
    ].join("");
    if (containers.modelFilter.innerHTML !== options) {
      containers.modelFilter.innerHTML = options;
      containers.modelFilter.value = currentSelected;
    }
  }

  containers.requestChart.innerHTML = state.requestLogs.length
    ? renderRequestChartMarkup(state.requestLogs, filters)
    : createEmptyState("Chưa có dữ liệu xu hướng", "Xu hướng yêu cầu sẽ hiển thị sau khi phát sinh yêu cầu.");
  containers.recentLogs.innerHTML = state.requestLogs.length
    ? renderRequestLogListMarkup(state.requestLogs.slice(0, 5))
    : createEmptyState("Chưa có yêu cầu gần đây", "Tóm tắt sẽ hiển thị sau khi hoàn thành yêu cầu.");
  containers.captchaAlerts.innerHTML = renderCaptchaAlerts(state.accounts);
}
export function renderSystemSettingsForm({ accounts, elements, isAdmin, settings }) {
  const captcha = settings?.captcha ?? {};
  elements.endpoint.value = captcha.yescaptchaEndpoint || "https://api.yescaptcha.com";
  elements.yescaptchaKey.placeholder = captcha.hasYescaptchaKey
    ? `Đã cấu hình: ${captcha.yescaptchaKeyMasked || "******"}, để trống để giữ nguyên`
    : "Nhập YesCaptcha clientKey";
  elements.autoSolve.checked = captcha.autoSolveEnabled === true;
  elements.visionFallback.checked = captcha.visionFallbackEnabled !== false;
  if (elements.chainOfThoughtOverride) {
    elements.chainOfThoughtOverride.checked = settings?.chainOfThoughtOverrideEnabled === true;
  }
  if (elements.toolParsingMode) {
    elements.toolParsingMode.checked = settings?.toolParsingModeEnabled === true;
  }
  if (elements.globalProxies) {
    elements.globalProxies.value = (settings?.globalProxies || []).join("\n");
  }
  if (elements.inputContentLimit) {
    elements.inputContentLimit.value = settings?.inputContentLimit ?? 160000;
  }
  elements.maxRetries.value = captcha.maxRetries ?? 3;
  elements.cooldownMs.value = captcha.cooldownMs ?? 60000;
  elements.visionAccount.innerHTML = [
    '<option value="">Tự động chọn tài khoản dự phòng</option>',
    ...accounts.map((account) => (
      `<option value="${escapeHtml(account.id)}">${escapeHtml(resolveAccountLabel(account))}</option>`
    ))
  ].join("");
  elements.visionAccount.value = captcha.visionFallbackAccountId || "";

  [
    elements.endpoint,
    elements.inputContentLimit,
    elements.yescaptchaKey,
    elements.clearKey,
    elements.autoSolve,
    elements.chainOfThoughtOverride,
    elements.toolParsingMode,
    elements.globalProxies,
    elements.visionFallback,
    elements.visionAccount,
    elements.maxRetries,
    elements.cooldownMs
  ].filter(Boolean).forEach((element) => {
    element.disabled = !isAdmin;
  });
}
export function setSelectOptions({ select, values }) {
  select.innerHTML = values.length
    ? values.map((value) => `<option>${escapeHtml(value)}</option>`).join("")
    : '<option value="">Chưa có đường dẫn</option>';
}
export function updateDashboardMetrics(options) {
  const {
    apiKeyCountElement,
    endpointCountElement,
    messageCountElement,
    sessionCaptionElement,
    sessionCountElement,
    sessionMetricElement,
    counts
  } = options;
  apiKeyCountElement.textContent = String(counts.apiKeys);
  endpointCountElement.textContent = String(counts.endpoints);
  messageCountElement.textContent = String(counts.messages);
  sessionCountElement.textContent = String(counts.sessions);
  sessionMetricElement.textContent = String(counts.sessions);
  sessionCaptionElement.textContent = counts.sessions
    ? `Tổng cộng ${counts.sessions} phiên`
    : "Chưa có phiên";
}
export function wireRippleEffects() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-ripple]");
    if (target) {
      createRipple({ event, target });
    }
  });
}

export function getActiveTab() {
  return document.body.dataset.activeTab || "dashboard";
}

export function resolveTabLabel(tab) {
  return TAB_LABELS[tab] ?? TAB_LABELS.dashboard;
}

export function setPageTitle(title) {
  const titleElement = document.getElementById("page-title");
  if (titleElement) {
    titleElement.textContent = title;
  }
}
