import { readStore, updateStore } from "../storage/store.js";
import { getSystemSettings } from "./system-settings-service.js";

function getOwnerEnabled(ownerId) {
  if (!ownerId) {
    return false;
  }

  return Boolean(readStore().toolParsingMode.owners[ownerId]);
}

export function getToolParsingModeState(ownerId) {
  const globalEnabled = getSystemSettings().toolParsingModeEnabled;
  const ownerEnabled = getOwnerEnabled(ownerId);

  return {
    effectiveEnabled: globalEnabled || ownerEnabled,
    globalEnabled,
    ownerEnabled
  };
}

export function isToolParsingModeEnabledForOwner(ownerId) {
  return getToolParsingModeState(ownerId).effectiveEnabled;
}

export function setOwnerToolParsingModeEnabled(ownerId, enabled) {
  if (!ownerId) {
    throw new Error("Owner ID is required");
  }

  return updateStore((state) => ({
    ...state,
    toolParsingMode: {
      ...state.toolParsingMode,
      owners: {
        ...state.toolParsingMode.owners,
        [ownerId]: Boolean(enabled)
      }
    }
  })).toolParsingMode;
}
