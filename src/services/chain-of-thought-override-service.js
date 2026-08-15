import { readStore, updateStore } from "../storage/store.js";
import { getSystemSettings } from "./system-settings-service.js";

function getOwnerEnabled(ownerId) {
  if (!ownerId) {
    return false;
  }

  return Boolean(readStore().chainOfThoughtOverride.owners[ownerId]);
}

export function getChainOfThoughtOverrideState(ownerId) {
  const globalEnabled = getSystemSettings().chainOfThoughtOverrideEnabled;
  const ownerEnabled = getOwnerEnabled(ownerId);

  return {
    effectiveEnabled: globalEnabled || ownerEnabled,
    globalEnabled,
    ownerEnabled
  };
}

export function isChainOfThoughtOverrideEnabledForOwner(ownerId) {
  return getChainOfThoughtOverrideState(ownerId).effectiveEnabled;
}

export function setOwnerChainOfThoughtOverrideEnabled(ownerId, enabled) {
  if (!ownerId) {
    throw new Error("Owner ID is required");
  }

  return updateStore((state) => ({
    ...state,
    chainOfThoughtOverride: {
      ...state.chainOfThoughtOverride,
      owners: {
        ...state.chainOfThoughtOverride.owners,
        [ownerId]: Boolean(enabled)
      }
    }
  })).chainOfThoughtOverride;
}
