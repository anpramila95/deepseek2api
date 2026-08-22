function collectSelectedValues(container, selector) {
  return Array.from(container.querySelectorAll(`${selector}:checked`)).map((input) => input.value);
}

function parseLimitValue(form, fieldName) {
  const input = form.querySelector(`[data-limit-field="${fieldName}"]`);
  return input ? input.value.trim() : "";
}

function bindRegistrationAction({ els, onToggleInviteRequirement, setStatus }) {
  els["admin-registration-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["admin-registration-status"], "Đang lưu...");

    try {
      await onToggleInviteRequirement(els["invite-required-toggle"].checked);
      setStatus(els["admin-registration-status"], "Đã lưu.");
    } catch (error) {
      setStatus(els["admin-registration-status"], error.message);
    }
  };
}

function bindInviteCreation({ els, onCreateInvites, setStatus }) {
  els["admin-invite-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["admin-invite-status"], "Đang tạo...");

    try {
      await onCreateInvites(els["admin-invite-count"].value);
      setStatus(els["admin-invite-status"], "Đã tạo.");
    } catch (error) {
      setStatus(els["admin-invite-status"], error.message);
    }
  };
}

function bindInviteDeletion({ els, onBatchDeleteInvites, onDeleteInvite, setStatus }) {
  els["delete-selected-invites"].onclick = async () => {
    const inviteIds = collectSelectedValues(els["admin-invite-list"], "[data-invite-select]");
    setStatus(els["admin-invite-status"], inviteIds.length ? "Đang xóa..." : "Vui lòng chọn trước.");

    if (!inviteIds.length) {
      return;
    }

    try {
      await onBatchDeleteInvites(inviteIds);
      setStatus(els["admin-invite-status"], "Đã xóa.");
    } catch (error) {
      setStatus(els["admin-invite-status"], error.message);
    }
  };

  els["admin-invite-list"].onclick = async (event) => {
    const button = event.target.closest("[data-invite-delete]");
    if (!button) {
      return;
    }

    setStatus(els["admin-invite-status"], "Đang xóa...");
    try {
      await onDeleteInvite(button.dataset.inviteDelete);
      setStatus(els["admin-invite-status"], "Đã xóa.");
    } catch (error) {
      setStatus(els["admin-invite-status"], error.message);
    }
  };
}

function bindUserBatchActions({ els, onBatchDeleteUsers, onBatchDisableUsers, setStatus }) {
  const runBatchDisable = async (disabled, pendingText, successText) => {
    const userIds = collectSelectedValues(els["admin-user-list"], "[data-user-select]");
    setStatus(els["admin-user-status"], userIds.length ? pendingText : "Vui lòng chọn trước.");

    if (!userIds.length) {
      return;
    }

    try {
      await onBatchDisableUsers({ disabled, userIds });
      setStatus(els["admin-user-status"], successText);
    } catch (error) {
      setStatus(els["admin-user-status"], error.message);
    }
  };

  els["disable-selected-users"].onclick = () => runBatchDisable(true, "Đang vô hiệu hàng loạt...", "Đã vô hiệu.");
  els["enable-selected-users"].onclick = () => runBatchDisable(false, "Đang kích hoạt hàng loạt...", "Đã kích hoạt.");
  els["delete-selected-users"].onclick = async () => {
    const userIds = collectSelectedValues(els["admin-user-list"], "[data-user-select]");
    setStatus(els["admin-user-status"], userIds.length ? "Đang xóa hàng loạt..." : "Vui lòng chọn trước.");

    if (!userIds.length) {
      return;
    }

    try {
      await onBatchDeleteUsers(userIds);
      setStatus(els["admin-user-status"], "Đã xóa.");
    } catch (error) {
      setStatus(els["admin-user-status"], error.message);
    }
  };
}

function bindUserRowActions({ els, onDeleteUser, onUpdateUser, setStatus }) {
  els["admin-user-list"].addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-user-form]");
    if (!form) {
      return;
    }

    event.preventDefault();
    setStatus(els["admin-user-status"], "Đang lưu...");

    try {
      await onUpdateUser(form.dataset.userForm, {
        requestLimits: {
          maxConcurrency: parseLimitValue(form, "maxConcurrency"),
          maxRequestsPerMinute: parseLimitValue(form, "maxRequestsPerMinute")
        }
      });
      setStatus(els["admin-user-status"], "Đã lưu.");
    } catch (error) {
      setStatus(els["admin-user-status"], error.message);
    }
  });

  els["admin-user-list"].onclick = async (event) => {
    const deleteButton = event.target.closest("[data-user-delete]");
    const toggleButton = event.target.closest("[data-user-toggle-disable]");

    if (deleteButton) {
      setStatus(els["admin-user-status"], "Đang xóa...");
      try {
        await onDeleteUser(deleteButton.dataset.userDelete);
        setStatus(els["admin-user-status"], "Đã xóa.");
      } catch (error) {
        setStatus(els["admin-user-status"], error.message);
      }
      return;
    }

    if (!toggleButton) {
      return;
    }

    const disabled = toggleButton.dataset.disabled === "false";
    setStatus(els["admin-user-status"], disabled ? "Đang vô hiệu..." : "Đang kích hoạt...");

    try {
      await onUpdateUser(toggleButton.dataset.userToggleDisable, { disabled });
      setStatus(els["admin-user-status"], disabled ? "Đã vô hiệu." : "Đã kích hoạt.");
    } catch (error) {
      setStatus(els["admin-user-status"], error.message);
    }
  };
}

export function bindAdminActions(options) {
  bindRegistrationAction(options);
  bindInviteCreation(options);
  bindInviteDeletion(options);
  bindUserBatchActions(options);
  bindUserRowActions(options);
}
