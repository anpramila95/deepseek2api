import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webglPath = path.resolve(__dirname, "../../waf/webgl.json");
const GPU_POOL = JSON.parse(fs.readFileSync(webglPath, "utf-8"));

const KEY = Buffer.from("6f71a512b1e035eaab53d8be73120d3fb68a0ca346b9560aab3e5cdf753d5e98", "hex");
const BWDTH_SIZES = { 1: 1024, 2: 10240, 3: 102400, 4: 1048576, 5: 10485760 };

const BRANDS = {
  0: '"Not/A)Brand";v="8", "Chromium";v="{v}", "Google Chrome";v="{v}"',
  1: '"Not A(Brand";v="24", "Chromium";v="{v}", "Google Chrome";v="{v}"',
  2: '"Chromium";v="{v}", "Not(A:Brand";v="24", "Google Chrome";v="{v}"',
  3: '"Not:A-Brand";v="8", "Chromium";v="{v}", "Google Chrome";v="{v}"'
};

const PLUGINS = [
  { name: "PDF Viewer", str: "PDF Viewer " },
  { name: "Chrome PDF Viewer", str: "Chrome PDF Viewer " },
  { name: "Chromium PDF Viewer", str: "Chromium PDF Viewer " },
  { name: "Microsoft Edge PDF Viewer", str: "Microsoft Edge PDF Viewer " },
  { name: "WebKit built-in PDF", str: "WebKit built-in PDF " }
];
const PLUGIN_STR = PLUGINS.map((p) => p.str).join("");
const SCREEN = "1920-1080-1080-24-*-*-*";

const BASE_BINS = [
  14469, 36, 41, 46, 47, 49, 28, 22, 44, 24, 38, 15, 39, 49, 32, 42, 31, 29, 22, 33,
  32, 27, 40, 28, 47, 12, 31, 32, 42, 20, 27, 35, 118, 22, 22, 31, 22, 13, 27, 26,
  27, 17, 27, 33, 15, 29, 29, 30, 33, 32, 27, 38, 31, 16, 35, 23, 22, 24, 19, 18,
  25, 23, 20, 22, 102, 15, 22, 13, 19, 19, 18, 24, 13, 26, 10, 15, 26, 16, 14, 19,
  16, 20, 18, 26, 18, 49, 15, 19, 24, 22, 19, 17, 15, 20, 21, 22, 103, 27, 50, 38,
  55, 31, 496, 25, 19, 15, 25, 24, 18, 53, 32, 13, 19, 19, 21, 20, 29, 18, 28, 30,
  19, 15, 14, 23, 28, 12, 33, 131, 41, 35, 33, 29, 8, 15, 13, 17, 28, 33, 41, 21,
  35, 23, 26, 33, 19, 20, 74, 34, 12, 24, 15, 20, 19, 71, 20, 9, 20, 18, 22, 84,
  20, 19, 27, 7, 31, 18, 21, 24, 13, 14, 40, 20, 39, 16, 27, 24, 29, 17, 18, 27,
  16, 14, 16, 26, 13, 17, 14, 22, 20, 15, 20, 99, 15, 9, 18, 16, 15, 20, 31, 13,
  28, 35, 27, 48, 52, 48, 33, 47, 32, 47, 42, 13, 28, 21, 25, 26, 30, 25, 15, 23,
  21, 27, 24, 115, 41, 30, 16, 20, 26, 17, 24, 36, 24, 32, 24, 60, 28, 33, 25, 37,
  48, 32, 31, 26, 19, 51, 34, 50, 31, 43, 43, 53, 76, 57, 50, 13659
];

const MATH = {
  tan: "-1.4214488238747245",
  sin: "0.8178819121159085",
  cos: "-0.5753861119575491"
};

const COLLECTORS = [
  ["fp2", "100", 0.5, 3],
  ["browser", "101", 0, 1],
  ["capabilities", "102", 2, 8],
  ["gpu", "103", 3, 12],
  ["dnt", "104", 0, 1],
  ["math", "105", 0, 1],
  ["screen", "106", 0, 1],
  ["navigator", "107", 0, 1],
  ["auto", "108", 0, 1],
  ["stealth", "undefined", 1, 4],
  ["subtle", "110", 0, 1],
  ["canvas", "111", 80, 200],
  ["formdetector", "112", 0, 3],
  ["be", "undefined", 0, 1]
];

function randRange(lo, hi) {
  return Number((Math.random() * (hi - lo) + lo).toFixed(1));
}

function randInt(lo, hi) {
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function parseUa(ua) {
  const m = ua.match(/Chrome\/(\d+)/);
  const ver = m ? m[1] : "144";
  const platform = ua.toLowerCase().includes("windows") ? "Windows" : "Linux";
  const brand = BRANDS[parseInt(ver, 10) % 4].replaceAll("{v}", ver);
  return { brand, platform };
}

function navHeaders(site, ua) {
  const { brand, platform } = parseUa(ua);
  return {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language": "en-US,en;q=0.9",
    "sec-ch-ua": brand,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"${platform}"`,
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": ua
  };
}

function apiHeaders(site, ua, sameOrigin = true) {
  const { brand, platform } = parseUa(ua);
  return {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    "ect": "4g",
    "origin": site,
    "pragma": "no-cache",
    "priority": "u=1, i",
    "referer": `${site}/`,
    "sec-ch-ua": brand,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"${platform}"`,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": sameOrigin ? "same-origin" : "cross-site",
    "user-agent": ua
  };
}

function randCanvas() {
  const bins = BASE_BINS.map((v) => {
    if (v > 500) return v + randInt(-200, 200);
    if (v > 80) return v + randInt(-15, 15);
    return Math.max(1, v + randInt(-3, 3));
  });
  return [randInt(100000000, 999999999), bins];
}

function buildMetrics(hasToken = false) {
  const collectors = COLLECTORS.map(([n, mid, lo, hi]) => [n, mid, randRange(lo, hi)]);
  const fpMetrics = {};
  for (const [n, _, v] of collectors) {
    fpMetrics[n] = Math.floor(v);
  }

  const enc = randRange(0.5, 3);
  const crypt = randRange(2, 8);
  const coll = collectors.reduce((sum, [, , v]) => sum + v, 0);
  const acq = Number((coll + enc + crypt + randRange(2, 6)).toFixed(1));
  const chall = randRange(2, 8);
  const cookie = randRange(0.1, 1);
  const total = Number((acq + chall + cookie).toFixed(1));

  const m = [{ name: "2", value: enc, unit: "2" }];
  for (const [, mid, v] of collectors) {
    m.push({ name: mid, value: v, unit: "2" });
  }
  m.push(
    { name: "3", value: crypt, unit: "2" },
    { name: "7", value: hasToken ? 1 : 0, unit: "4" },
    { name: "1", value: acq, unit: "2" },
    { name: "4", value: chall, unit: "2" },
    { name: "5", value: cookie, unit: "2" },
    { name: "6", value: total, unit: "2" },
    { name: "8", value: 1, unit: "4" }
  );

  return [m, fpMetrics];
}

function buildSignal(site, fpMetrics, ua) {
  const now = Date.now();
  const gpu = GPU_POOL[randInt(0, GPU_POOL.length - 1)];
  const [cHash, cBins] = randCanvas();

  return {
    metrics: fpMetrics,
    start: now,
    flashVersion: null,
    plugins: PLUGINS,
    dupedPlugins: `${PLUGIN_STR}||${SCREEN}`,
    screenInfo: SCREEN,
    referrer: "",
    userAgent: ua,
    location: site,
    webDriver: false,
    capabilities: {
      css: { textShadow: 1, WebkitTextStroke: 1, boxShadow: 1, borderRadius: 1, borderImage: 1, opacity: 1, transform: 1, transition: 1 },
      js: { audio: true, geolocation: true, localStorage: "supported", touch: false, video: true, webWorker: true },
      elapsed: fpMetrics.capabilities
    },
    gpu,
    dnt: null,
    math: MATH,
    automation: { wd: { properties: { document: [], window: [], navigator: [] } }, phantom: { properties: { window: [] } } },
    stealth: { t1: 0, t2: 0, i: 1, mte: 0, mtd: false },
    crypto: { crypto: 1, subtle: 1, encrypt: true, decrypt: true, wrapKey: true, unwrapKey: true, sign: true, verify: true, digest: true, deriveBits: true, deriveKey: true, getRandomValues: true, randomUUID: true },
    canvas: { hash: cHash, emailHash: null, histogramBins: cBins },
    formDetected: false,
    numForms: 0,
    numFormElements: 0,
    be: { si: false },
    end: now + 1,
    errors: [],
    version: "2.4.0",
    id: crypto.randomUUID()
  };
}

function encodeSignal(obj) {
  const raw = JSON.stringify(obj);
  const crc = zlib.crc32(Buffer.from(raw)).toString(16).padStart(8, "0").toUpperCase();
  return `${crc}#${raw}`;
}

function encryptSignal(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}::${tag.toString("hex")}::${ct.toString("hex")}`;
}

function checkZeros(hashBuf, difficulty) {
  let z = 0;
  for (const b of hashBuf) {
    if (b === 0) {
      z += 8;
    } else {
      for (let i = 7; i >= 0; i--) {
        if ((b & (1 << i)) === 0) z++;
        else break;
      }
      break;
    }
  }
  return z >= difficulty;
}

function solvePoW(challengeInput, checksum, difficulty, ctype, memory = 128) {
  const combined = challengeInput + checksum;
  if (ctype === "HashcashScrypt") {
    const salt = Buffer.from(checksum);
    for (let n = 0; n < 100000000; n++) {
      const derived = crypto.scryptSync(`${combined}${n}`, salt, 32, { N: memory, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
      if (checkZeros(derived, difficulty)) return String(n);
    }
  } else if (ctype === "SHA256") {
    const base = Buffer.from(combined);
    for (let n = 0; n < 100000000; n++) {
      const h = crypto.createHash("sha256").update(Buffer.concat([base, Buffer.from(String(n))])).digest();
      if (checkZeros(h, difficulty)) return String(n);
    }
  }
  return "0";
}

function prepareChallenge(site, ua, hasToken) {
  const [metrics, fpMetrics] = buildMetrics(hasToken);
  const fp = buildSignal(`${site}/`, fpMetrics, ua);
  const encoded = encodeSignal(fp);
  const checksum = encoded.split("#")[0];
  const encrypted = encryptSignal(encoded);
  return { checksum, encrypted, metrics };
}

export async function solveWaf(site, ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36", options = {}) {
  const fetchFn = options.fetch || globalThis.fetch;
  site = site.replace(/\/+$/, "");
  const domain = new URL(site).hostname;

  // 1. Discover challenge URL
  const navRes = await fetchFn(site, { headers: navHeaders(site, ua) });
  const html = await navRes.text();

  let chalUrl = null;
  let sameOrigin = true;

  const mSame = html.match(/(\/__challenge_[A-Za-z0-9]+\/[a-f0-9]+\/[a-f0-9]+)/);
  if (mSame) {
    chalUrl = `${site}${mSame[1]}`;
    sameOrigin = true;
  } else {
    let mExt = html.match(/(https:\/\/[a-z0-9]+\.[a-z0-9]+\.[a-z0-9-]+\.token\.awswaf\.com\/[^/\s"]+\/[^/\s"]+\/[^/\s"]+)/);
    if (!mExt) {
      mExt = html.match(/(https:\/\/[a-z0-9]+\.edge\.sdk\.awswaf\.com\/[a-z0-9]+\/[a-z0-9]+)\/challenge\.js/);
    }
    if (mExt) {
      chalUrl = mExt[1];
      sameOrigin = false;
    } else {
      throw new Error("AWS WAF challenge URL not found in response HTML");
    }
  }

  const mGoku = html.match(/window\.gokuProps\s*=\s*(\{[^}]+\})/);
  const goku = mGoku ? JSON.parse(mGoku[1]) : null;

  const hdrs = apiHeaders(site, ua, sameOrigin);
  let token = null;

  // 2. Execute verification rounds
  for (let roundIdx = 0; roundIdx < 2; roundIdx++) {
    const hasToken = roundIdx > 0;
    const { checksum, encrypted, metrics } = prepareChallenge(site, ua, hasToken);

    const tInp = Date.now();
    const inpRes = await fetchFn(`${chalUrl}/inputs?client=browser`, { headers: hdrs });
    const inpLatency = Number((Date.now() - tInp).toFixed(1));
    const inputs = await inpRes.json();

    const challenge = inputs.challenge;
    const decoded = JSON.parse(Buffer.from(challenge.input, "base64").toString("utf-8"));
    const ctype = decoded.challenge_type || "";
    const difficulty = decoded.difficulty || 1;
    const memory = decoded.memory || 128;

    if (hasToken) {
      metrics.unshift({ name: "0", value: inpLatency, unit: "2" });
    }

    let body;
    let contentType;

    if (ctype === "NetworkBandwidth") {
      const sz = BWDTH_SIZES[difficulty] || 1024;
      const solData = Buffer.alloc(sz).toString("base64");
      const meta = {
        challenge,
        solution: null,
        signals: [{ name: "Zoey", value: { Present: encrypted } }],
        checksum,
        existing_token: null,
        client: "Browser",
        domain,
        metrics
      };
      if (goku) meta.goku_props = goku;

      const boundary = "----WebKitFormBoundary" + crypto.randomBytes(8).toString("hex");
      const parts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="solution_data"\r\n\r\n${solData}`,
        `--${boundary}\r\nContent-Disposition: form-data; name="solution_metadata"\r\n\r\n${JSON.stringify(meta)}`,
        `--${boundary}--\r\n`
      ];
      body = parts.join("\r\n");
      contentType = `multipart/form-data; boundary=${boundary}`;
    } else {
      const solution = solvePoW(challenge.input, checksum, difficulty, ctype, memory);
      const data = {
        challenge,
        solution,
        signals: [{ name: "Zoey", value: { Present: encrypted } }],
        checksum,
        existing_token: null,
        client: "Browser",
        domain,
        metrics
      };
      if (goku) data.goku_props = goku;
      body = JSON.stringify(data);
      contentType = "text/plain;charset=UTF-8";
    }

    const endpoint = ctype === "NetworkBandwidth" ? "mp_verify" : "verify";
    const verRes = await fetchFn(`${chalUrl}/${endpoint}`, {
      method: "POST",
      headers: { ...hdrs, "content-type": contentType },
      body
    });
    const result = await verRes.json();

    if (roundIdx === 0) {
      token = result.token || null;
    } else {
      token = result.token || token;
    }

    if (token) break;
  }

  return { token, cookie: token ? `aws-waf-token=${token}` : null };
}
