import { saveAccount } from "./account-service.js";
import { buildDeepseekAccountForOwner } from "./auth-service.js";
import { loginToDeepseek } from "./deepseek-auth.js";
import { resolveDeepseekClientProfile } from "./deepseek-device.js";
import {
  disableDataOptimizationForAccount,
  reportClientSettingsForAccount
} from "./deepseek-settings.js";

export async function importDeepseekAccountForOwner({
  deviceId,
  deviceProfile,
  loginValue,
  ownerId,
  password
}) {
  const resolvedProfile = resolveDeepseekClientProfile(deviceProfile ?? { deviceId });
  const loginResult = await loginToDeepseek({
    loginValue,
    password,
    deviceProfile: resolvedProfile
  });
  const pendingAccount = buildDeepseekAccountForOwner({
    ownerId,
    loginValue,
    password,
    deviceProfile: resolvedProfile,
    loginResult
  });

  // Privacy is part of account import success. Do not persist a newly bound
  // account until the upstream setting has been confirmed.
  const privacyResult = await disableDataOptimizationForAccount(pendingAccount);
  const account = saveAccount({
    ...pendingAccount,
    dataOptimizationDisabled: privacyResult.trainingAllowed === false,
    lastPrivacyUpdate: privacyResult.confirmedAt,
    trainingAllowed: false
  });
  const reportResult = await reportClientSettingsForAccount(account);
  return reportResult.account ?? account;
}
