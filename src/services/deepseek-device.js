import { createHash, randomBytes, randomUUID } from "node:crypto";

import { config } from "../config.js";

// The web client currently uses a base64 encoded opaque device token.  Keep
// validation deliberately format-oriented rather than tying it to one fixed
// value.  A token generated from 66 bytes has 88 base64 characters, while the
// wider lower bound keeps older local fixtures readable during migration.
const LOGIN_DEVICE_ID_PATTERN = /^B[A-Za-z0-9+/=]{80,}$/;
const CLIENT_DID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_PROFILE_PLATFORMS = Object.freeze(["Windows", "macOS", "Linux"]);
const DEFAULT_CHROME_VERSIONS = Object.freeze(["149", "150", "151"]);
const DEFAULT_CLIENT_SOURCES = Object.freeze(["chat-web"]);
const DEFAULT_SCREEN_SIZES = Object.freeze([
  [1920, 1080],
  [1536, 864],
  [1440, 900],
  [1366, 768],
  [2560, 1440]
]);
const DEFAULT_GPU_PROFILES = Object.freeze([
  Object.freeze({
    platform: "Windows",
    vendor: "Google Inc. (Intel)",
    renderer: "ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0)"
  }),
  Object.freeze({
    platform: "Windows",
    vendor: "Google Inc. (NVIDIA)",
    renderer: "ANGLE (NVIDIA, NVIDIA GeForce Graphics Direct3D11 vs_5_0 ps_5_0)"
  }),
  Object.freeze({
    platform: "macOS",
    vendor: "Apple Inc.",
    renderer: "Apple GPU"
  }),
  Object.freeze({
    platform: "Linux",
    vendor: "Google Inc. (Mesa)",
    renderer: "ANGLE (Mesa, Vulkan Graphics)"
  })
]);
const PLATFORM_USER_AGENT_TOKENS = Object.freeze({
  Windows: "Windows NT 10.0; Win64; x64",
  macOS: "Macintosh; Intel Mac OS X 10_15_7",
  Linux: "X11; Linux x86_64"
});
const DEFAULT_TOUCH_POINTS = Object.freeze({
  Windows: Object.freeze([0, 0, 0, 10]),
  macOS: Object.freeze([0]),
  Linux: Object.freeze([0, 0, 1])
});
const DEFAULT_LOCALE_PROFILES = Object.freeze([
  Object.freeze({
    locale: "zh_CN",
    browserLocale: "zh-CN",
    acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
    timezoneOffset: "28800"
  })
]);
const CLIENT_HINT_GREASE_BRANDS = Object.freeze([
  Object.freeze({ brand: "Not_A Brand", version: "99" }),
  Object.freeze({ brand: "Not)A;Brand", version: "8" }),
  Object.freeze({ brand: "Not A(Brand", version: "24" })
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

function normalizeHostPlatform(value, fallback = "Windows") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "windows" || normalized === "win32") {
    return "Windows";
  }
  if (normalized === "macos" || normalized === "mac" || normalized === "macintel") {
    return "macOS";
  }
  if (normalized === "linux" || normalized === "linux x86_64") {
    return "Linux";
  }
  return fallback;
}

function normalizeBrowserLocale(value, fallback = "zh-CN") {
  const normalized = normalizeString(value, fallback).replaceAll("_", "-");
  const [language = "zh", region] = normalized.split("-");
  return region
    ? `${language.toLowerCase()}-${region.toUpperCase()}`
    : language.toLowerCase();
}

function createAcceptLanguage(browserLocale) {
  const baseLanguage = browserLocale.split("-")[0];
  if (baseLanguage === "en") {
    return `${browserLocale},en;q=0.9`;
  }
  return `${browserLocale},${baseLanguage};q=0.9,en;q=0.8`;
}

function normalizeLocaleProfiles(value) {
  const profiles = Array.isArray(value) ? value : [];
  const normalized = profiles.flatMap((profile) => {
    if (!profile || typeof profile !== "object") {
      return [];
    }

    const locale = normalizeString(profile.locale);
    const timezoneOffset = normalizeString(profile.timezoneOffset);
    if (!locale || !timezoneOffset || !Number.isFinite(Number(timezoneOffset))) {
      return [];
    }

    const browserLocale = normalizeBrowserLocale(profile.browserLocale ?? locale);
    return [{
      locale,
      browserLocale,
      acceptLanguage: normalizeString(
        profile.acceptLanguage,
        createAcceptLanguage(browserLocale)
      ),
      timezoneOffset
    }];
  });
  return normalized.length ? normalized : DEFAULT_LOCALE_PROFILES;
}

function inferHostPlatformFromUserAgent(userAgent) {
  const value = String(userAgent ?? "");
  if (/Windows NT/i.test(value)) {
    return "Windows";
  }
  if (/Macintosh|Mac OS X/i.test(value)) {
    return "macOS";
  }
  if (/Linux/i.test(value)) {
    return "Linux";
  }
  return null;
}

function isUserAgentCompatible(userAgent, hostPlatform) {
  const detected = inferHostPlatformFromUserAgent(userAgent);
  return !detected || detected === hostPlatform;
}

function normalizeGpuProfiles(value) {
  const profiles = Array.isArray(value) ? value : [];
  const normalized = profiles.flatMap((profile) => {
    if (!profile || typeof profile !== "object") {
      return [];
    }

    const vendor = normalizeString(profile.vendor);
    const renderer = normalizeString(profile.renderer);
    const platform = normalizeHostPlatform(profile.platform, "");
    if (!platform || !vendor || !renderer) {
      return [];
    }

    return [{
      platform,
      vendor,
      renderer
    }];
  });
  return normalized.length ? normalized : DEFAULT_GPU_PROFILES;
}

function selectGpuProfile(hostPlatform, seed) {
  const configuredProfiles = normalizeGpuProfiles(config.deepseekProfile?.gpuProfiles);
  const platformProfiles = configuredProfiles.filter((profile) => profile.platform === hostPlatform);
  const selected = seededChoice(
    platformProfiles.length ? platformProfiles : configuredProfiles,
    `${seed}:gpu-profile`
  );
  const vendorOverrides = normalizeArray(config.deepseekProfile?.gpuVendors, []);
  const rendererOverrides = normalizeArray(config.deepseekProfile?.gpuRenderers, []);

  if (vendorOverrides.length && rendererOverrides.length) {
    const pairCount = Math.min(vendorOverrides.length, rendererOverrides.length);
    const digest = createHash("sha256").update(`${seed}:gpu-override`).digest();
    const index = digest.readUInt32BE(0) % pairCount;
    return {
      vendor: String(vendorOverrides[index]),
      renderer: String(rendererOverrides[index])
    };
  }

  return selected;
}

function removeEmptyHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value !== undefined && value !== "")
  );
}

function normalizeLoginDeviceId(value) {
  return LOGIN_DEVICE_ID_PATTERN.test(String(value ?? "")) ? String(value) : generateDeepseekDeviceId();
}

function deriveClientDid(seed) {
  const hex = createHash("sha256").update(`deepseek2api:did:${seed}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${(8 + (Number.parseInt(hex[16], 16) % 4)).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function normalizeClientDid(value, fallbackSeed = "") {
  if (CLIENT_DID_PATTERN.test(String(value ?? ""))) {
    return String(value);
  }

  return fallbackSeed ? deriveClientDid(fallbackSeed) : randomUUID();
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
  const selectedVersion = String(seededChoice(versions, seed));
  const version = /^\d+$/.test(selectedVersion)
    ? `${selectedVersion}.0.0.0`
    : selectedVersion;
  const platformToken = PLATFORM_USER_AGENT_TOKENS[platform]
    ?? PLATFORM_USER_AGENT_TOKENS.Windows;
  return `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

function createChromeClientHints(userAgent, seed) {
  const version = userAgent.match(/Chrome\/(\d+)/i)?.[1];
  if (!version) {
    return "";
  }

  const grease = seededChoice(CLIENT_HINT_GREASE_BRANDS, `${seed}:client-hint-grease`);
  return `"${grease.brand}";v="${grease.version}", "Chromium";v="${version}", "Google Chrome";v="${version}"`;
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
  const gpuProfile = selectGpuProfile(hostPlatform, seed);
  const touchPoints = DEFAULT_TOUCH_POINTS[hostPlatform] ?? [0];
  const hardwareConcurrency = normalizeArray(
    config.deepseekProfile?.hardwareConcurrency,
    ["4", "6", "8", "12", "16"]
  );
  const deviceMemory = normalizeArray(config.deepseekProfile?.deviceMemory, ["4", "8", "16"]);
  const screenWidth = normalizeNumber(inputFingerprint.screenWidth, defaultScreen[0]);
  const screenHeight = normalizeNumber(inputFingerprint.screenHeight, defaultScreen[1]);

  return {
    // Cross-field identity is canonicalized to one persona.  This also heals
    // profiles produced by older browser code where hostPlatform and the
    // fingerprint platform were selected independently.
    platform: hostPlatform,
    languages: Array.from(new Set([
      normalizeBrowserLocale(input.browserLocale ?? locale),
      ...normalizeArray(inputFingerprint.languages, []).map((entry) => normalizeBrowserLocale(entry)),
      "en-US"
    ])),
    timezoneOffset: Number(timezoneOffset) || 0,
    screenWidth,
    screenHeight,
    colorDepth: normalizeNumber(inputFingerprint.colorDepth, seededChoice([24, 30], `${seed}:color-depth`)),
    hardwareConcurrency: normalizeNumber(
      inputFingerprint.hardwareConcurrency,
      Number(seededChoice(hardwareConcurrency, `${seed}:cpu`))
    ),
    deviceMemory: normalizeNumber(
      inputFingerprint.deviceMemory,
      Number(seededChoice(deviceMemory, `${seed}:memory`))
    ),
    maxTouchPoints: normalizeNumber(
      inputFingerprint.maxTouchPoints,
      Number(seededChoice(touchPoints, `${seed}:touch-points`))
    ),
    webglVendor: normalizeString(inputFingerprint.webglVendor, gpuProfile.vendor),
    webglRenderer: normalizeString(inputFingerprint.webglRenderer, gpuProfile.renderer)
  };
}

function fingerprintHash(fingerprint) {
  return createHash("sha256")
    .update(JSON.stringify(fingerprint))
    .digest("hex");
}

// ==================== 核心 profile 生成 ====================
export function createSimulatedClientProfile(input = {}) {
  const suppliedLoginDeviceId = input.loginDeviceId ?? input.deviceId;
  const hasSuppliedLoginDeviceId = LOGIN_DEVICE_ID_PATTERN.test(String(suppliedLoginDeviceId ?? ""));
  const loginDeviceId = normalizeLoginDeviceId(suppliedLoginDeviceId);
  const clientDid = normalizeClientDid(
    input.clientDid ?? input.did,
    hasSuppliedLoginDeviceId ? loginDeviceId : ""
  );
  const identitySeed = `${clientDid}:${loginDeviceId}`;
  const platform = normalizeString(input.platform ?? config.deepseekHeaders.clientPlatform, "web");
  const profilePlatforms = normalizeArray(config.deepseekProfile?.platforms, DEFAULT_PROFILE_PLATFORMS);
  const chromeVersions = normalizeArray(config.deepseekProfile?.chromeVersions, DEFAULT_CHROME_VERSIONS);
  const sources = normalizeArray(config.deepseekProfile?.sources, DEFAULT_CLIENT_SOURCES);
  const localeProfiles = normalizeLocaleProfiles(config.deepseekProfile?.localeProfiles);
  const localeProfile = seededChoice(localeProfiles, `${identitySeed}:locale-profile`);
  const suppliedUserAgent = normalizeString(
    input.userAgent ?? config.deepseekHeaders.userAgent
  );
  const inferredHostPlatform = inferHostPlatformFromUserAgent(suppliedUserAgent);
  const hintedHostPlatform = normalizeHostPlatform(
    String(input.secChUaPlatform ?? config.deepseekHeaders.secChUaPlatform).replaceAll('"', ""),
    ""
  );
  const hostPlatform = normalizeHostPlatform(
    input.hostPlatform
      ?? input.environment?.hostPlatform
      ?? inferredHostPlatform
      ?? hintedHostPlatform,
    normalizeHostPlatform(seededChoice(profilePlatforms, `${identitySeed}:platform`))
  );
  const locale = normalizeString(
    input.locale ?? config.deepseekHeaders.locale,
    localeProfile.locale
  );
  const browserLocale = normalizeBrowserLocale(
    input.browserLocale ?? input.environment?.browserLocale,
    locale === localeProfile.locale
      ? localeProfile.browserLocale
      : normalizeBrowserLocale(locale)
  );
  const timezoneOffset = normalizeString(
    input.timezoneOffset ?? config.deepseekHeaders.timezoneOffset,
    localeProfile.timezoneOffset
  );
  const acceptLanguage = normalizeString(
    input.acceptLanguage,
    locale === localeProfile.locale
      ? localeProfile.acceptLanguage
      : createAcceptLanguage(browserLocale)
  );
  const userAgent = suppliedUserAgent && isUserAgentCompatible(suppliedUserAgent, hostPlatform)
    ? suppliedUserAgent
    : createChromeUserAgent(hostPlatform, chromeVersions, `${identitySeed}:ua`);
  const migratedSecChUa = Number(input.profileVersion) >= 3 || input.profileVersion === undefined
    ? input.secChUa
    : "";
  const secChUa = normalizeString(
    migratedSecChUa || config.deepseekHeaders.secChUa,
    createChromeClientHints(userAgent, identitySeed)
  );
  const fingerprint = createFingerprint({
    hostPlatform,
    locale,
    timezoneOffset,
    input: { ...input, browserLocale },
    seed: identitySeed
  });
  const createdAt = normalizeString(input.createdAt, new Date().toISOString());
  const browserVersion = userAgent.match(/Chrome\/(\d+(?:\.\d+){0,3})/i)?.[1] ?? "";
  const environment = {
    hostPlatform,
    browserName: normalizeString(input.environment?.browserName, "Chrome"),
    browserVersion,
    locale,
    browserLocale,
    acceptLanguage,
    timezoneOffset,
    fingerprint
  };

  return {
    profileVersion: 3,
    loginDeviceId,
    clientDid,
    os: normalizeString(input.os, platform),
    bundleId: normalizeString(input.bundleId, config.deepseekHeaders.clientBundleId),
    clientVersion: normalizeString(input.clientVersion, config.deepseekHeaders.clientVersion || "2.3.0"),
    platform,
    locale,
    browserLocale,
    acceptLanguage,
    timezoneOffset,
    areaCode: normalizeString(input.areaCode, config.deepseekHeaders.areaCode || "+86"),
    userAgent,
    secChUa,
    secChUaMobile: normalizeString(input.secChUaMobile, config.deepseekHeaders.secChUaMobile || "?0"),
    secChUaPlatform: `"${hostPlatform}"`,
    source: normalizeString(input.source, seededChoice(sources, `${identitySeed}:source`)),
    hostPlatform,
    fingerprint,
    environment,
    fingerprintHash: fingerprintHash(fingerprint),
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
    "accept-language": profile.acceptLanguage,
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
