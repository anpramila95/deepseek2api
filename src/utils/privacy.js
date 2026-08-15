const EMAIL_PATTERN = /([A-Za-z0-9._%+-]{1,64})@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const PHONE_PATTERN = /(?<!\d)(\+?\d{2,4})?1\d{10}(?!\d)/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const KEY_VALUE_SECRET_PATTERN =
  /(["']?(?:authorization|access_token|refresh_token|token|password|passwd|pwd|cookie|set-cookie|device_id|deviceId|x-device-id|did|x-client-did|x-app-token|x-client-token)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi;

function visibleHead(value, count = 2) {
  return value.slice(0, Math.min(count, value.length));
}

function visibleTail(value, count = 2) {
  return value.slice(Math.max(0, value.length - count));
}

export function maskEmail(value) {
  const email = String(value ?? "").trim();
  const match = /^([^@]+)@(.+)$/.exec(email);
  if (!match) {
    return email;
  }

  const [, local, domain] = match;
  return visibleHead(local) + "***@" + domain;
}

export function maskPhone(value) {
  const phone = String(value ?? "").trim();
  if (phone.length < 7) {
    return phone ? "***" : "";
  }

  return visibleHead(phone, 3) + "****" + visibleTail(phone, 4);
}

export function maskIdentifier(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }

  if (text.includes("*")) {
    return text;
  }

  if (text.includes("@")) {
    return maskEmail(text);
  }

  if (/^\+?\d+$/.test(text)) {
    return maskPhone(text);
  }

  if (text.length <= 8) {
    return visibleHead(text, 1) + "***";
  }

  return visibleHead(text, 3) + "***" + visibleTail(text, 3);
}

export function redactSensitiveText(value, maxLength = 700) {
  const text = String(value ?? "");
  const redacted = text
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(KEY_VALUE_SECRET_PATTERN, "$1[REDACTED]")
    .replace(EMAIL_PATTERN, (_match, local, domain) => visibleHead(local) + "***@" + domain)
    .replace(PHONE_PATTERN, (match) => maskPhone(match));

  return redacted.length > maxLength ? redacted.slice(0, maxLength) + "..." : redacted;
}

export function createSafeUpstreamError(prefix, { status, body = "" } = {}) {
  const details = body ? " Body preview: " + redactSensitiveText(body, 360) : "";
  return new Error(prefix + " (HTTP " + (status ?? "unknown") + ")." + details);
}
