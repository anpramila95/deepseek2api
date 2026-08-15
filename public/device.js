let deviceIdPromise;
let profilePromise;

const DEVICE_ID_STORAGE_KEY = "deepseek2api.device_id.v3";
const PROFILE_STORAGE_KEY = "deepseek2api.client_profile.v1";
const DEVICE_ID_PATTERN = /^B[A-Za-z0-9+/=]{80,}$/;

function createRandomDeviceId() {
  // Keep the browser fixture in the same shape as the server-side profile
  // generator: 66 bytes become 88 base64 characters after the `B` marker.
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

function createBrowserFingerprint(hostPlatform) {
  const screenSizes = [
    [1920, 1080],
    [1536, 864],
    [1440, 900],
    [1366, 768],
    [2560, 1440]
  ];
  const [screenWidth, screenHeight] = randomChoice(screenSizes);
  const locale = navigator.language || "en-US";

  return {
    platform: hostPlatform,
    languages: Array.from(new Set([locale, ...(navigator.languages || []), "en-US"])),
    timezoneOffset: new Date().getTimezoneOffset() * -60,
    screenWidth,
    screenHeight,
    colorDepth: Number(window.screen?.colorDepth) || 24,
    hardwareConcurrency: randomChoice([4, 6, 8, 12, 16]),
    deviceMemory: randomChoice([4, 8, 16]),
    maxTouchPoints: 0,
    webglVendor: "Generic GPU Vendor",
    webglRenderer: "Generic GPU Renderer"
  };
}

export async function getDeviceProfile() {
  if (!profilePromise) {
    profilePromise = Promise.resolve().then(async () => {
      const saved = window.localStorage?.getItem(PROFILE_STORAGE_KEY);
      if (saved) {
        try {
          const profile = JSON.parse(saved);
          if (profile && isValidDeviceId(profile.loginDeviceId)) {
            return profile;
          }
        } catch {
          // Recreate malformed local fixture data below.
        }
      }

      const hostPlatform = randomChoice(["Windows", "macOS", "Linux"]);
      const profile = {
        loginDeviceId: await getDeviceId(),
        clientDid: crypto.randomUUID(),
        hostPlatform: randomChoice(["Windows", "macOS", "Linux"]),
        platform: "web",
        os: "web",
        bundleId: "",
        clientVersion: "",
        locale: navigator.language || "en-US",
        timezoneOffset: String(new Date().getTimezoneOffset() * -60),
        source: randomChoice(["chat-web", "chat-web-v2", "chat-web-v3"]),
        fingerprint: createBrowserFingerprint(hostPlatform),
        createdAt: new Date().toISOString()
      };
      window.localStorage?.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
      return profile;
    });
  }

  return profilePromise;
}

export function rotateDeviceId() {
  const deviceId = createRandomDeviceId();
  window.localStorage?.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  window.localStorage?.removeItem(PROFILE_STORAGE_KEY);
  deviceIdPromise = Promise.resolve(deviceId);
  profilePromise = null;
  return deviceId;
}
