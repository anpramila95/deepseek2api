import { readStore, updateStore } from "../storage/store.js";

function normalizeRegistrationSettings(value) {
  return {
    inviteRequired: Boolean(value?.inviteRequired),
  };
}

export function getRegistrationSettings() {
  return normalizeRegistrationSettings(readStore().registration);
}

export function setRegistrationSettings(patch) {
  let nextSettings;

  updateStore((state) => {
    nextSettings = normalizeRegistrationSettings({
      ...state.registration,
      ...patch,
    });

    return {
      ...state,
      registration: nextSettings,
    };
  });

  return nextSettings;
}
