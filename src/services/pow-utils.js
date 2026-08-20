const SECONDS_TIMESTAMP_LIMIT = 100_000_000_000;

// DeepSeek currently returns expire_at in milliseconds. Older fixtures and
// compatible endpoints may use Unix seconds, so accept both representations.
export const POW_CHALLENGE_SAFETY_WINDOW_MS = 30_000;

export function resolvePowExpireAtMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }

  return numeric < SECONDS_TIMESTAMP_LIMIT ? numeric * 1_000 : numeric;
}

export function getPowChallengeExpireAtMs(challenge) {
  return resolvePowExpireAtMs(challenge?.expire_at ?? challenge?.expireAt);
}

export function isPowChallengeFresh(
  challenge,
  now = Date.now(),
  safetyWindowMs = POW_CHALLENGE_SAFETY_WINDOW_MS
) {
  const expireAtMs = getPowChallengeExpireAtMs(challenge);
  const currentTimeMs = Number(now);
  const safetyMs = Math.max(0, Number(safetyWindowMs) || 0);

  return expireAtMs > 0
    && Number.isFinite(currentTimeMs)
    && expireAtMs > currentTimeMs + safetyMs;
}

export function isInvalidPowResponseText(value) {
  return /\bINVALID_POW_RESPONSE\b/i.test(String(value ?? ""));
}
