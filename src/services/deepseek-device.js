import { createHash, randomBytes, randomUUID } from "node:crypto";

import { config } from "../config.js";

// The web client currently uses a base64 encoded opaque device token.  Keep
// validation deliberately format-oriented rather than tying it to one fixed
// value.  A token generated from 66 bytes has 88 base64 characters, while the
// wider lower bound keeps older local fixtures readable during migration.
const LOGIN_DEVICE_ID_PATTERN = /^B[A-Za-z0-9+/=]{80,}$/;
const CLIENT_DID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_PROFILE_PLATFORMS = Object.freeze(["Windows", "macOS", "Linux"]);
const DEFAULT_CHROME_VERSIONS = Object.freeze(["126", "127", "128", "129", "130"]);
const DEFAULT_CLIENT_SOURCES = Object.freeze([
  "chat-web",
  "chat-web-v2",
  "chat-web-v3"
]);
const DEFAULT_SCREEN_SIZES = Object.freeze([
  [1920, 1080],
  [1536, 864],
  [1440, 900],
  [1366, 768],
  [2560, 1440]
]);

function randomChoice(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function seededChoice(values, seed) {
  if (!values.length || !seed) {
    return randomChoice(values);
  }

  const digest = createHash("sha256").update(String(seed)).digest();
  const index = digest.readUInt32BE(0) % values.length;
  return values[index];
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeArray(value, fallback) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const entries = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : entry))
    .filter((entry) => entry !== "");
  return entries.length ? entries : fallback;
}

function removeEmptyHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value !== undefined && value !== "")
  );
}

function normalizeLoginDeviceId(value) {
  return LOGIN_DEVICE_ID_PATTERN.test(String(value ?? "")) ? String(value) : generateDeepseekDeviceId();
}

function normalizeClientDid(value) {
  return CLIENT_DID_PATTERN.test(String(value ?? "")) ? String(value) : randomUUID();
}

export function generateDeepseekDeviceId() {
  // 66 bytes -> 88 base64 characters, prefixed with the web client's marker.
  return `B${randomBytes(66).toString("base64")}`;
}

export function generateClientDid() {
  return randomUUID();
}

export function isDeepseekDeviceId(value) {
  return typeof value === "string" && LOGIN_DEVICE_ID_PATTERN.test(value);
}

export function isClientDid(value) {
  return typeof value === "string" && CLIENT_DID_PATTERN.test(value);
}

// ==================== 可变浏览器环境 ====================
function createChromeUserAgent(platform, versions = DEFAULT_CHROME_VERSIONS, seed = "") {
  const version = seededChoice(versions, seed);
  const base = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`;
  if (platform === "macOS") {
    return base.replace("Windows", "Macintosh; Intel Mac OS X 10_15_7");
  }
  if (platform === "Linux") {
    return base.replace("Windows", "X11; Linux x86_64");
  }
  return base;
}

function createFingerprint({ hostPlatform, locale, timezoneOffset, input = {}, seed = "" }) {
  const directFingerprint = input.fingerprint && typeof input.fingerprint === "object"
    ? input.fingerprint
    : null;
  const nestedFingerprint = input.environment?.fingerprint
    && typeof input.environment.fingerprint === "object"
    ? input.environment.fingerprint
    : null;
  const inputFingerprint = directFingerprint ?? nestedFingerprint ?? {};
  const screenSizes = normalizeArray(config.deepseekProfile?.screenSizes, DEFAULT_SCREEN_SIZES)
    .filter((size) => Array.isArray(size) && size.length >= 2);
  const defaultScreen = seededChoice(
    screenSizes.length ? screenSizes : DEFAULT_SCREEN_SIZES,
    `${seed}:screen`
  );
  const gpuVendors = normalizeArray(config.deepseekProfile?.gpuVendors, ["Generic GPU Vendor"]);
  const gpuRenderers = normalizeArray(config.deepseekProfile?.gpuRenderers, ["Generic GPU Renderer"]);
  const hardwareConcurrency = normalizeArray(
    config.deepseekProfile?.hardwareConcurrency,
    ["4", "6", "8", "12", "16"]
  );
  const deviceMemory = normalizeArray(config.deepseekProfile?.deviceMemory, ["4", "8", "16"]);
  const screenWidth = normalizeNumber(inputFingerprint.screenWidth, defaultScreen[0]);
  const screenHeight = normalizeNumber(inputFingerprint.screenHeight, defaultScreen[1]);

  return {
    platform: normalizeString(inputFingerprint.platform, hostPlatform),
    languages: normalizeArray(inputFingerprint.languages, [locale, "en-US"]),
    timezoneOffset: normalizeNumber(inputFingerprint.timezoneOffset, Number(timezoneOffset) || 0),
    screenWidth,
    screenHeight,
    colorDepth: normalizeNumber(inputFingerprint.colorDepth, 24),
    hardwareConcurrency: normalizeNumber(
      inputFingerprint.hardwareConcurrency,
      Number(seededChoice(hardwareConcurrency, `${seed}:cpu`))
    ),
    deviceMemory: normalizeNumber(
      inputFingerprint.deviceMemory,
      Number(seededChoice(deviceMemory, `${seed}:memory`))
    ),
    maxTouchPoints: normalizeNumber(inputFingerprint.maxTouchPoints, hostPlatform === "Windows" ? 0 : 0),
    webglVendor: normalizeString(inputFingerprint.webglVendor, seededChoice(gpuVendors, `${seed}:gpu-vendor`)),
    webglRenderer: normalizeString(inputFingerprint.webglRenderer, seededChoice(gpuRenderers, `${seed}:gpu-renderer`))
  };
}

function fingerprintHash(fingerprint) {
  return createHash("sha256")
    .update(JSON.stringify(fingerprint))
    .digest("hex");
}

// ==================== 核心 profile 生成 ====================
export function createSimulatedClientProfile(input = {}) {
  const identitySeed = input.clientDid ?? input.did ?? input.loginDeviceId ?? input.deviceId ?? "";
  const platform = normalizeString(input.platform ?? config.deepseekHeaders.clientPlatform, "web");
  const profilePlatforms = normalizeArray(config.deepseekProfile?.platforms, DEFAULT_PROFILE_PLATFORMS);
  const chromeVersions = normalizeArray(config.deepseekProfile?.chromeVersions, DEFAULT_CHROME_VERSIONS);
  const sources = normalizeArray(config.deepseekProfile?.sources, DEFAULT_CLIENT_SOURCES);
  const hostPlatform = normalizeString(
    input.hostPlatform,
    seededChoice(profilePlatforms, `${identitySeed}:platform`)
  );
  const locale = normalizeString(input.locale, config.deepseekHeaders.locale || "zh_CN");
  const timezoneOffset = normalizeString(
    input.timezoneOffset,
    config.deepseekHeaders.timezoneOffset || "28800"
  );
  const userAgent = normalizeString(
    input.userAgent,
    createChromeUserAgent(hostPlatform, chromeVersions, `${identitySeed}:ua`)
  );
  const secChUa = normalizeString(
    input.secChUa,
    (() => {
      const version = userAgent.match(/Chrome\/(\d+)/i)?.[1];
      if (!version) {
        return config.deepseekHeaders.secChUa || "";
      }
      return `"Chromium";v="${version}", "Google Chrome";v="${version}", "Not-A.Brand";v="99"`;
    })()
  );
  const fingerprint = createFingerprint({
    hostPlatform,
    locale,
    timezoneOffset,
    input,
    seed: identitySeed
  });
  const createdAt = normalizeString(input.createdAt, new Date().toISOString());
  const browserVersion = userAgent.match(/Chrome\/(\d+(?:\.\d+){0,3})/i)?.[1] ?? "";
  const environment = {
    hostPlatform,
    browserName: normalizeString(input.environment?.browserName, "Chrome"),
    browserVersion: normalizeString(input.environment?.browserVersion, browserVersion),
    locale,
    timezoneOffset,
    fingerprint
  };

  return {
    loginDeviceId: normalizeLoginDeviceId(input.loginDeviceId ?? input.deviceId),
    clientDid: normalizeClientDid(input.clientDid ?? input.did),
    os: normalizeString(input.os, platform),
    bundleId: normalizeString(input.bundleId, config.deepseekHeaders.clientBundleId),
    clientVersion: normalizeString(input.clientVersion, config.deepseekHeaders.clientVersion || "2.3.0"),
    platform,
    locale,
    timezoneOffset,
    areaCode: normalizeString(input.areaCode, config.deepseekHeaders.areaCode || "+86"),
    userAgent,
    secChUa,
    secChUaMobile: normalizeString(input.secChUaMobile, config.deepseekHeaders.secChUaMobile || "?0"),
    secChUaPlatform: normalizeString(input.secChUaPlatform, `"${hostPlatform}"`),
    source: normalizeString(input.source, seededChoice(sources, `${identitySeed}:source`)),
    hostPlatform,
    fingerprint,
    environment,
    fingerprintHash: normalizeString(input.fingerprintHash, fingerprintHash(fingerprint)),
    createdAt
  };
}

export function resolveDeepseekDeviceId(candidate) {
  return normalizeLoginDeviceId(candidate);
}

export function resolveDeepseekClientProfile(accountOrProfile = {}) {
  const profile = accountOrProfile.deviceProfile ?? accountOrProfile;
  const nextProfile = createSimulatedClientProfile({
    ...profile,
    loginDeviceId: profile.loginDeviceId ?? accountOrProfile.loginDeviceId ?? accountOrProfile.deviceId,
    clientDid: profile.clientDid ?? accountOrProfile.clientDid
  });
  return {
    ...nextProfile,
    deviceId: nextProfile.loginDeviceId
  };
}

export function createDeepseekClientHeaders(profileSource = {}, extraHeaders = {}) {
  const profile = resolveDeepseekClientProfile(profileSource);
  return removeEmptyHeaders({
    "user-agent": profile.userAgent || config.deepseekHeaders.userAgent || undefined,
    "sec-ch-ua": profile.secChUa || config.deepseekHeaders.secChUa || undefined,
    "sec-ch-ua-mobile": profile.secChUaMobile || config.deepseekHeaders.secChUaMobile || undefined,
    "sec-ch-ua-platform": profile.secChUaPlatform || config.deepseekHeaders.secChUaPlatform || undefined,
    "x-client-locale": profile.locale,
    "x-client-bundle-id": profile.bundleId,
    "x-client-timezone-offset": profile.timezoneOffset,
    "x-client-version": profile.clientVersion,
    "x-client-platform": profile.platform,
    "x-client-source": profile.source,
    "x-client-did": profile.clientDid,
    "x-device-id": profile.loginDeviceId,
    "accept-language": profile.locale,
    ...extraHeaders
  });
}

export function withResolvedDeepseekClientProfile(account) {
  const deviceProfile = resolveDeepseekClientProfile(account);
  return {
    ...account,
    deviceId: deviceProfile.loginDeviceId,
    loginDeviceId: deviceProfile.loginDeviceId,
    clientDid: deviceProfile.clientDid,
    deviceProfile
  };
}
