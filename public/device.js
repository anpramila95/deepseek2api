let deviceIdPromise;
let profilePromise;

const DEVICE_ID_STORAGE_KEY = "deepseek2api.device_id.v3";
const PROFILE_STORAGE_KEY = "deepseek2api.client_profile.v3";
const PREVIOUS_PROFILE_STORAGE_KEY = "deepseek2api.client_profile.v2";
const LEGACY_PROFILE_STORAGE_KEY = "deepseek2api.client_profile.v1";
const DEVICE_ID_PATTERN = /^B[A-Za-z0-9+/=]{80,}$/;
const CLIENT_DID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FALLBACK_CHROME_VERSIONS = Object.freeze(["149", "150", "151"]);
const CLIENT_SOURCES = Object.freeze(["chat-web"]);
const CLIENT_HINT_GREASE_BRANDS = Object.freeze([
  Object.freeze({ brand: "Not_A Brand", version: "99" }),
  Object.freeze({ brand: "Not)A;Brand", version: "8" }),
  Object.freeze({ brand: "Not A(Brand", version: "24" })
]);
const PERSONAS = Object.freeze([
  Object.freeze({
    hostPlatform: "Windows",
    userAgentPlatform: "Windows NT 10.0; Win64; x64",
    screens: Object.freeze([[1920, 1080], [1536, 864], [1366, 768], [2560, 1440]]),
    cpu: Object.freeze([4, 8, 12, 16]),
    memory: Object.freeze([4, 8, 16]),
    touchPoints: Object.freeze([0, 0, 0, 10]),
    gpu: Object.freeze([
      Object.freeze({
        vendor: "Google Inc. (Intel)",
        renderer: "ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0)"
      }),
      Object.freeze({
        vendor: "Google Inc. (NVIDIA)",
        renderer: "ANGLE (NVIDIA, NVIDIA GeForce Graphics Direct3D11 vs_5_0 ps_5_0)"
      })
    ])
  }),
  Object.freeze({
    hostPlatform: "macOS",
    userAgentPlatform: "Macintosh; Intel Mac OS X 10_15_7",
    screens: Object.freeze([[1440, 900], [1680, 1050], [2560, 1600]]),
    cpu: Object.freeze([8, 10, 12]),
    memory: Object.freeze([8, 16]),
    touchPoints: Object.freeze([0]),
    gpu: Object.freeze([
      Object.freeze({ vendor: "Apple Inc.", renderer: "Apple GPU" }),
      Object.freeze({ vendor: "Apple Inc.", renderer: "Apple M-series GPU" })
    ])
  }),
  Object.freeze({
    hostPlatform: "Linux",
    userAgentPlatform: "X11; Linux x86_64",
    screens: Object.freeze([[1920, 1080], [1536, 864], [2560, 1440]]),
    cpu: Object.freeze([4, 8, 12, 16]),
    memory: Object.freeze([4, 8, 16]),
    touchPoints: Object.freeze([0, 0, 1]),
    gpu: Object.freeze([
      Object.freeze({ vendor: "Google Inc. (Mesa)", renderer: "ANGLE (Mesa, Vulkan Graphics)" }),
      Object.freeze({ vendor: "Mesa", renderer: "Mesa DRI Graphics" })
    ])
  })
]);

function createRandomDeviceId() {
  // 66 random bytes become an 88-character base64 token after the marker.
  const bytes = new Uint8Array(66);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return "B" + btoa(binary);
}

function isValidDeviceId(value) {
  return typeof value === "string" && DEVICE_ID_PATTERN.test(value);
}

function isValidClientDid(value) {
  return typeof value === "string" && CLIENT_DID_PATTERN.test(value);
}

export async function getDeviceId() {
  if (!deviceIdPromise) {
    deviceIdPromise = Promise.resolve().then(() => {
      const saved = window.localStorage?.getItem(DEVICE_ID_STORAGE_KEY);
      if (isValidDeviceId(saved)) {
        return saved;
      }

      const deviceId = createRandomDeviceId();
      window.localStorage?.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
      return deviceId;
    });
  }

  return deviceIdPromise;
}

function randomChoice(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function getChromeVersionPool() {
  const detectedMajor = Number(
    String(navigator.userAgent || "").match(/Chrom(?:e|ium)\/(\d+)/i)?.[1]
  );
  if (!Number.isInteger(detectedMajor) || detectedMajor < 100) {
    return FALLBACK_CHROME_VERSIONS;
  }

  return [detectedMajor, detectedMajor - 1, detectedMajor - 2].map(String);
}

function createUserAgent(persona, chromeVersion) {
  return `Mozilla/5.0 (${persona.userAgentPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion}.0.0.0 Safari/537.36`;
}

function createClientHints(chromeVersion) {
  const grease = randomChoice(CLIENT_HINT_GREASE_BRANDS);
  return `"${grease.brand}";v="${grease.version}", "Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}"`;
}

function createAcceptLanguage(browserLocale) {
  const baseLanguage = browserLocale.split("-")[0];
  return baseLanguage === "en"
    ? `${browserLocale},en;q=0.9`
    : `${browserLocale},${baseLanguage};q=0.9,en;q=0.8`;
}

function createBrowserFingerprint({ gpu, hostPlatform, locale, persona, screen }) {
  return {
    platform: hostPlatform,
    languages: Array.from(new Set([locale, ...(navigator.languages || []), "en-US"])),
    timezoneOffset: new Date().getTimezoneOffset() * -60,
    screenWidth: screen[0],
    screenHeight: screen[1],
    colorDepth: randomChoice([24, 30]),
    hardwareConcurrency: randomChoice(persona.cpu),
    deviceMemory: randomChoice(persona.memory),
    maxTouchPoints: randomChoice(persona.touchPoints),
    webglVendor: gpu.vendor,
    webglRenderer: gpu.renderer
  };
}

function isCompatibleUserAgent(userAgent, hostPlatform) {
  const marker = hostPlatform === "Windows"
    ? /Windows NT/i
    : hostPlatform === "macOS"
      ? /Macintosh|Mac OS X/i
      : /Linux/i;
  return marker.test(String(userAgent ?? ""));
}

function isCoherentProfile(profile) {
  const hostPlatform = profile?.hostPlatform;
  return profile?.profileVersion === 3
    && PERSONAS.some((persona) => persona.hostPlatform === hostPlatform)
    && isValidDeviceId(profile.loginDeviceId)
    && isValidClientDid(profile.clientDid)
    && profile.fingerprint?.platform === hostPlatform
    && profile.environment?.hostPlatform === hostPlatform
    && profile.environment?.fingerprint?.platform === hostPlatform
    && profile.secChUaPlatform === `"${hostPlatform}"`
    && isCompatibleUserAgent(profile.userAgent, hostPlatform);
}

function readSavedProfile() {
  const saved = window.localStorage?.getItem(PROFILE_STORAGE_KEY);
  if (!saved) {
    return null;
  }

  try {
    const profile = JSON.parse(saved);
    return isCoherentProfile(profile) ? profile : null;
  } catch {
    return null;
  }
}

async function createDeviceProfile() {
  const persona = randomChoice(PERSONAS);
  const hostPlatform = persona.hostPlatform;
  const chromeVersion = randomChoice(getChromeVersionPool());
  const browserLocale = navigator.language || "zh-CN";
  const locale = browserLocale.replaceAll("-", "_");
  const acceptLanguage = createAcceptLanguage(browserLocale);
  const timezoneOffset = String(new Date().getTimezoneOffset() * -60);
  const screen = randomChoice(persona.screens);
  const gpu = randomChoice(persona.gpu);
  const userAgent = createUserAgent(persona, chromeVersion);
  const fingerprint = createBrowserFingerprint({
    gpu,
    hostPlatform,
    locale: browserLocale,
    persona,
    screen
  });

  return {
    profileVersion: 3,
    loginDeviceId: await getDeviceId(),
    clientDid: crypto.randomUUID(),
    hostPlatform,
    platform: "web",
    os: "web",
    bundleId: "com.deepseek.chat",
    clientVersion: "2.3.0",
    locale,
    browserLocale,
    acceptLanguage,
    timezoneOffset,
    source: randomChoice(CLIENT_SOURCES),
    userAgent,
    secChUa: createClientHints(chromeVersion),
    secChUaMobile: "?0",
    secChUaPlatform: `"${hostPlatform}"`,
    fingerprint,
    environment: {
      hostPlatform,
      browserName: "Chrome",
      browserVersion: `${chromeVersion}.0.0.0`,
      locale,
      browserLocale,
      acceptLanguage,
      timezoneOffset,
      fingerprint
    },
    createdAt: new Date().toISOString()
  };
}

export async function getDeviceProfile() {
  if (!profilePromise) {
    profilePromise = Promise.resolve().then(async () => {
      const saved = readSavedProfile();
      if (saved) {
        return saved;
      }

      const profile = await createDeviceProfile();
      window.localStorage?.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
      window.localStorage?.removeItem(PREVIOUS_PROFILE_STORAGE_KEY);
      window.localStorage?.removeItem(LEGACY_PROFILE_STORAGE_KEY);
      return profile;
    });
  }

  return profilePromise;
}

export function rotateDeviceId() {
  const deviceId = createRandomDeviceId();
  window.localStorage?.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  window.localStorage?.removeItem(PROFILE_STORAGE_KEY);
  window.localStorage?.removeItem(PREVIOUS_PROFILE_STORAGE_KEY);
  window.localStorage?.removeItem(LEGACY_PROFILE_STORAGE_KEY);
  deviceIdPromise = Promise.resolve(deviceId);
  profilePromise = null;
  return deviceId;
}
