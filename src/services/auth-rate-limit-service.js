const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MS = 60_000; // 1 minute

const failedAttempts = new Map();

function pruneExpired(ip, now) {
  const attempts = failedAttempts.get(ip) ?? [];
  const valid = attempts.filter((timestamp) => now - timestamp < WINDOW_MS);
  if (valid.length === 0) {
    failedAttempts.delete(ip);
  } else {
    failedAttempts.set(ip, valid);
  }
  return valid;
}

export function checkAuthRateLimit(ip) {
  const now = Date.now();
  const valid = pruneExpired(ip, now);
  if (valid.length >= MAX_FAILED_ATTEMPTS) {
    const oldest = valid[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    return {
      allowed: false,
      retryAfterSeconds
    };
  }
  return {
    allowed: true,
    retryAfterSeconds: 0
  };
}

export function recordFailedAuth(ip) {
  const now = Date.now();
  const valid = pruneExpired(ip, now);
  failedAttempts.set(ip, [...valid, now]);
}

export function resetAuthRateLimit(ip) {
  failedAttempts.delete(ip);
}
