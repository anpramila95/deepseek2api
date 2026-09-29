import crypto from "crypto";
import zlib from "zlib";
import axios from "axios";

// ==========================================
// 1. THUẬT TOÁN DES TÙY BIẾN CỦA SHUMEI (des_sm)
// ==========================================
function des_sm(text, key) {
  const pc1 = [
    0x1010400, 0x0, 0x10000, 0x1010404, 0x1010004, 0x10404, 0x4, 0x10000, 0x400,
    0x1010400, 0x1010404, 0x400, 0x1000404, 0x1010004, 0x1000000, 0x4, 0x404,
    0x1000400, 0x1000400, 0x10400, 0x10400, 0x1010000, 0x1010000, 0x1000404,
    0x10004, 0x1000004, 0x1000004, 0x10004, 0x0, 0x404, 0x10404, 0x1000000,
    0x10000, 0x1010404, 0x4, 0x1010000, 0x1010400, 0x1000000, 0x1000000, 0x400,
    0x1010004, 0x10000, 0x10400, 0x1000004, 0x400, 0x4, 0x1000404, 0x10404,
    0x1010404, 0x10004, 0x1010000, 0x1000404, 0x1000004, 0x404, 0x10404,
    0x1010400, 0x404, 0x1000400, 0x1000400, 0x0, 0x10004, 0x10400, 0x0,
    0x1010004,
  ];
  const pc2 = [
    -0x7fef7fe0, -0x7fff8000, 0x8000, 0x108020, 0x100000, 0x20, -0x7fefffe0,
    -0x7fff7fe0, -0x7fffffe0, -0x7fef7fe0, -0x7fef8000, -0x80000000,
    -0x7fff8000, 0x100000, 0x20, -0x7fefffe0, 0x108000, 0x100020, -0x7fff7fe0,
    0x0, -0x80000000, 0x8000, 0x108020, -0x7ff00000, 0x100020, -0x7fffffe0, 0x0,
    0x108000, 0x8020, -0x7fef8000, -0x7ff00000, 0x8020, 0x0, 0x108020,
    -0x7fefffe0, 0x100000, -0x7fff7fe0, -0x7ff00000, -0x7fef8000, 0x8000,
    -0x7ff00000, -0x7fff8000, 0x20, -0x7fef7fe0, 0x108020, 0x20, 0x8000,
    -0x80000000, 0x8020, -0x7fef8000, 0x100000, -0x7fffffe0, 0x100020,
    -0x7fff7fe0, -0x7fffffe0, 0x100020, 0x108000, 0x0, -0x7fff8000, 0x8020,
    -0x80000000, -0x7fefffe0, -0x7fef7fe0, 0x108000,
  ];
  const pc3 = [
    0x208, 0x8020200, 0x0, 0x8020008, 0x8000200, 0x0, 0x20208, 0x8000200,
    0x20008, 0x8000008, 0x8000008, 0x20000, 0x8020208, 0x20008, 0x8020000,
    0x208, 0x8000000, 0x8, 0x8020200, 0x200, 0x20200, 0x8020000, 0x8020008,
    0x20208, 0x8000208, 0x20200, 0x20000, 0x8000208, 0x8, 0x8020208, 0x200,
    0x8000000, 0x8020200, 0x8000000, 0x20008, 0x208, 0x20000, 0x8020200,
    0x8000200, 0x0, 0x200, 0x20008, 0x8020208, 0x8000200, 0x8000008, 0x200, 0x0,
    0x8020008, 0x8000208, 0x20000, 0x8000000, 0x8020208, 0x8, 0x20208, 0x20200,
    0x8000008, 0x8020000, 0x8000208, 0x208, 0x8020000, 0x20208, 0x8, 0x8020008,
    0x20200,
  ];
  const pc4 = [
    0x802001, 0x2081, 0x2081, 0x80, 0x802080, 0x800081, 0x800001, 0x2001, 0x0,
    0x802000, 0x802000, 0x802081, 0x81, 0x0, 0x800080, 0x800001, 0x1, 0x2000,
    0x800000, 0x802001, 0x80, 0x800000, 0x2001, 0x2080, 0x800081, 0x1, 0x2080,
    0x800080, 0x2000, 0x802080, 0x802081, 0x81, 0x800080, 0x800001, 0x802000,
    0x802081, 0x81, 0x0, 0x0, 0x802000, 0x2080, 0x800080, 0x800081, 0x1,
    0x802001, 0x2081, 0x2081, 0x80, 0x802081, 0x81, 0x1, 0x2000, 0x800001,
    0x2001, 0x802080, 0x800081, 0x2001, 0x2080, 0x800000, 0x802001, 0x80,
    0x800000, 0x2000, 0x802080,
  ];
  const pc5 = [
    0x100, 0x2080100, 0x2080000, 0x42000100, 0x80000, 0x100, 0x40000000,
    0x2080000, 0x40080100, 0x80000, 0x2000100, 0x40080100, 0x42000100,
    0x42080000, 0x80100, 0x40000000, 0x2000000, 0x40080000, 0x40080000, 0x0,
    0x40000100, 0x42080100, 0x42080100, 0x2000100, 0x42080000, 0x40000100, 0x0,
    0x42000000, 0x2080100, 0x2000000, 0x42000000, 0x80100, 0x80000, 0x42000100,
    0x100, 0x2000000, 0x40000000, 0x2080000, 0x42000100, 0x40080100, 0x2000100,
    0x40000000, 0x42080000, 0x2080100, 0x40080100, 0x100, 0x2000000, 0x42080000,
    0x42080100, 0x80100, 0x42000000, 0x42080100, 0x2080000, 0x0, 0x40080000,
    0x42000000, 0x80100, 0x2000100, 0x40000100, 0x80000, 0x0, 0x40080000,
    0x2080100, 0x40000100,
  ];
  const pc6 = [
    0x20000010, 0x20400000, 0x4000, 0x20404010, 0x20400000, 0x10, 0x20404010,
    0x400000, 0x20004000, 0x404010, 0x400000, 0x20000010, 0x400010, 0x20004000,
    0x20000000, 0x4010, 0x0, 0x400010, 0x20004010, 0x4000, 0x404000, 0x20004010,
    0x10, 0x20400010, 0x20400010, 0x0, 0x404010, 0x20404000, 0x4010, 0x404000,
    0x20404000, 0x20000000, 0x20004000, 0x10, 0x20400010, 0x404000, 0x20404010,
    0x400000, 0x4010, 0x20000010, 0x400000, 0x20004000, 0x20000000, 0x4010,
    0x20000010, 0x20404010, 0x404000, 0x20400000, 0x404010, 0x20404000, 0x0,
    0x20400010, 0x10, 0x4000, 0x20400000, 0x404010, 0x4000, 0x400010,
    0x20004010, 0x0, 0x20404000, 0x20000000, 0x400010, 0x20004010,
  ];
  const pc7 = [
    0x200000, 0x4200002, 0x4000802, 0x0, 0x800, 0x4000802, 0x200802, 0x4200800,
    0x4200802, 0x200000, 0x0, 0x4000002, 0x2, 0x4000000, 0x4200002, 0x802,
    0x4000800, 0x200802, 0x200002, 0x4000800, 0x4000002, 0x4200000, 0x4200800,
    0x200002, 0x4200000, 0x800, 0x802, 0x4200802, 0x200800, 0x2, 0x4000000,
    0x200800, 0x4000000, 0x200800, 0x200000, 0x4000802, 0x4000802, 0x4200002,
    0x4200002, 0x2, 0x200002, 0x4000000, 0x4000800, 0x200000, 0x4200800, 0x802,
    0x200802, 0x4200800, 0x802, 0x4000002, 0x4200802, 0x4200000, 0x200800, 0x0,
    0x2, 0x4200802, 0x0, 0x200802, 0x4200000, 0x800, 0x4000002, 0x4000800,
    0x800, 0x200002,
  ];
  const pc8 = [
    0x10001040, 0x1000, 0x40000, 0x10041040, 0x10000000, 0x10001040, 0x40,
    0x10000000, 0x40040, 0x10040000, 0x10041040, 0x41000, 0x10041000, 0x41040,
    0x1000, 0x40, 0x10040000, 0x10000040, 0x10001000, 0x1040, 0x41000, 0x40040,
    0x10040040, 0x10041000, 0x1040, 0x0, 0x0, 0x10040040, 0x10000040,
    0x10001000, 0x41040, 0x40000, 0x41040, 0x40000, 0x10041000, 0x1000, 0x40,
    0x10040040, 0x1000, 0x41040, 0x10001000, 0x40, 0x10000040, 0x10040000,
    0x10040040, 0x10000000, 0x40000, 0x10001040, 0x0, 0x10041040, 0x40040,
    0x10000040, 0x10040000, 0x10001000, 0x10001040, 0x0, 0x10041040, 0x41000,
    0x41000, 0x1040, 0x1040, 0x40040, 0x10000000, 0x10041000,
  ];

  function calcSubKeys(kStr) {
    const kBits1 = [
      0x0, 0x4, 0x20000000, 0x20000004, 0x10000, 0x10004, 0x20010000,
      0x20010004, 0x200, 0x204, 0x20000200, 0x20000204, 0x10200, 0x10204,
      0x20010200, 0x20010204,
    ];
    const kBits2 = [
      0x0, 0x1, 0x100000, 0x100001, 0x4000000, 0x4000001, 0x4100000, 0x4100001,
      0x100, 0x101, 0x100100, 0x100101, 0x4000100, 0x4000101, 0x4100100,
      0x4100101,
    ];
    const kBits3 = [
      0x0, 0x8, 0x800, 0x808, 0x1000000, 0x1000008, 0x1000800, 0x1000808, 0x0,
      0x8, 0x800, 0x808, 0x1000000, 0x1000008, 0x1000800, 0x1000808,
    ];
    const kBits4 = [
      0x0, 0x200000, 0x8000000, 0x8200000, 0x2000, 0x202000, 0x8002000,
      0x8202000, 0x20000, 0x220000, 0x8020000, 0x8220000, 0x22000, 0x222000,
      0x8022000, 0x8222000,
    ];
    const kBits5 = [
      0x0, 0x40000, 0x10, 0x40010, 0x0, 0x40000, 0x10, 0x40010, 0x1000, 0x41000,
      0x1010, 0x41010, 0x1000, 0x41000, 0x1010, 0x41010,
    ];
    const kBits6 = [
      0x0, 0x400, 0x20, 0x420, 0x0, 0x400, 0x20, 0x420, 0x2000000, 0x2000400,
      0x2000020, 0x2000420, 0x2000000, 0x2000400, 0x2000020, 0x2000420,
    ];
    const kBits7 = [
      0x0, 0x10000000, 0x80000, 0x10080000, 0x2, 0x10000002, 0x80002,
      0x10080002, 0x0, 0x10000000, 0x80000, 0x10080000, 0x2, 0x10000002,
      0x80002, 0x10080002,
    ];
    const kBits8 = [
      0x0, 0x10000, 0x800, 0x10800, 0x20000000, 0x20010000, 0x20000800,
      0x20010800, 0x20000, 0x30000, 0x20800, 0x30800, 0x20020000, 0x20030000,
      0x20020800, 0x20030800,
    ];
    const kBits9 = [
      0x0, 0x40000, 0x0, 0x40000, 0x2, 0x40002, 0x2, 0x40002, 0x2000000,
      0x2040000, 0x2000000, 0x2040000, 0x2000002, 0x2040002, 0x2000002,
      0x2040002,
    ];
    const kBits10 = [
      0x0, 0x10000000, 0x8, 0x10000008, 0x0, 0x10000000, 0x8, 0x10000008, 0x400,
      0x10000400, 0x408, 0x10000408, 0x400, 0x10000400, 0x408, 0x10000408,
    ];
    const kBits11 = [
      0x0, 0x20, 0x0, 0x20, 0x100000, 0x100020, 0x100000, 0x100020, 0x2000,
      0x2020, 0x2000, 0x2020, 0x102000, 0x102020, 0x102000, 0x102020,
    ];
    const kBits12 = [
      0x0, 0x1000000, 0x200, 0x1000200, 0x200000, 0x1200000, 0x200200,
      0x1200200, 0x4000000, 0x5000000, 0x4000200, 0x5000200, 0x4200000,
      0x5200000, 0x4200200, 0x5200200,
    ];
    const kBits13 = [
      0x0, 0x1000, 0x8000000, 0x8001000, 0x80000, 0x81000, 0x8080000, 0x8081000,
      0x10, 0x1010, 0x8000010, 0x8001010, 0x80010, 0x81010, 0x8080010,
      0x8081010,
    ];
    const kBits14 = [
      0x0, 0x4, 0x100, 0x104, 0x0, 0x4, 0x100, 0x104, 0x1, 0x5, 0x101, 0x105,
      0x1, 0x5, 0x101, 0x105,
    ];

    const loopCount = kStr.length > 8 ? 3 : 1;
    const subKeys = new Array(32 * loopCount);
    const shiftTable = [0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0];
    let p = 0,
      dest = 0;

    for (let i = 0; i < loopCount; i++) {
      let left =
        (kStr.charCodeAt(p++) << 24) |
        (kStr.charCodeAt(p++) << 16) |
        (kStr.charCodeAt(p++) << 8) |
        kStr.charCodeAt(p++);
      let right =
        (kStr.charCodeAt(p++) << 24) |
        (kStr.charCodeAt(p++) << 16) |
        (kStr.charCodeAt(p++) << 8) |
        kStr.charCodeAt(p++);
      let temp;

      left ^= (temp = 0xf0f0f0f & ((left >>> 4) ^ right)) << 4;
      left ^= temp = 0xffff & (((right ^= temp) >>> -16) ^ left);
      left ^=
        (temp = 0x33333333 & ((left >>> 2) ^ (right ^= temp << -16))) << 2;
      left ^= temp = 0xffff & (((right ^= temp) >>> -16) ^ left);
      left ^=
        (temp = 0x55555555 & ((left >>> 1) ^ (right ^= temp << -16))) << 1;
      left ^= temp = 0xff00ff & (((right ^= temp) >>> 8) ^ left);
      temp =
        ((left ^=
          (temp = 0x55555555 & ((left >>> 1) ^ (right ^= temp << 8))) << 1) <<
          8) |
        (((right ^= temp) >>> 20) & 0xf0);
      left =
        (right << 24) |
        ((right << 8) & 0xff0000) |
        ((right >>> 8) & 0xff00) |
        ((right >>> 24) & 0xf0);
      right = temp;

      for (let r = 0; r < shiftTable.length; r++) {
        if (shiftTable[r]) {
          left = (left << 2) | (left >>> 26);
          right = (right << 2) | (right >>> 26);
        } else {
          left = (left << 1) | (left >>> 27);
          right = (right << 1) | (right >>> 27);
        }
        right &= -15;
        left &= -15;

        const b1 =
          kBits1[left >>> 28] |
          kBits2[(left >>> 24) & 15] |
          kBits3[(left >>> 20) & 15] |
          kBits4[(left >>> 16) & 15] |
          kBits5[(left >>> 12) & 15] |
          kBits6[(left >>> 8) & 15] |
          kBits7[(left >>> 4) & 15];
        const b2 =
          kBits8[right >>> 28] |
          kBits9[(right >>> 24) & 15] |
          kBits10[(right >>> 20) & 15] |
          kBits11[(right >>> 16) & 15] |
          kBits12[(right >>> 12) & 15] |
          kBits13[(right >>> 8) & 15] |
          kBits14[(right >>> 4) & 15];
        temp = 0xffff & ((b2 >>> 16) ^ b1);
        subKeys[dest++] = b1 ^ temp;
        subKeys[dest++] = b2 ^ (temp << 16);
      }
    }
    return subKeys;
  }

  const subKeys = calcSubKeys(key);
  let len = text.length;
  const numRounds = subKeys.length === 32 ? 3 : 9;
  const roundIdx =
    numRounds === 3 ? [0, 32, 2] : [0, 32, 2, 62, 30, -2, 64, 96, 2];

  text += "\x00\x00\x00\x00\x00\x00\x00\x00";

  let out = "",
    p = 0;
  while (p < len) {
    let left =
      (text.charCodeAt(p++) << 24) |
      (text.charCodeAt(p++) << 16) |
      (text.charCodeAt(p++) << 8) |
      text.charCodeAt(p++);
    let right =
      (text.charCodeAt(p++) << 24) |
      (text.charCodeAt(p++) << 16) |
      (text.charCodeAt(p++) << 8) |
      text.charCodeAt(p++);
    let temp;

    left ^= (temp = 0xf0f0f0f & ((left >>> 4) ^ right)) << 4;
    left ^= (temp = 0xffff & ((left >>> 16) ^ (right ^= temp))) << 16;
    left ^= temp = 0x33333333 & (((right ^= temp) >>> 2) ^ left);
    left ^= temp = 0xff00ff & (((right ^= temp << 2) >>> 8) ^ left);
    left =
      ((left ^=
        (temp = 0x55555555 & ((left >>> 1) ^ (right ^= temp << 8))) << 1) <<
        1) |
      (left >>> 31);
    right = ((right ^= temp) << 1) | (right >>> 31);

    for (let r = 0; r < numRounds; r += 3) {
      const end = roundIdx[r + 1],
        step = roundIdx[r + 2];
      for (let idx = roundIdx[r]; idx !== end; idx += step) {
        const f1 = right ^ subKeys[idx];
        const f2 = ((right >>> 4) | (right << 28)) ^ subKeys[idx + 1];
        temp = left;
        left = right;
        right =
          temp ^
          (pc2[(f1 >>> 24) & 63] |
            pc4[(f1 >>> 16) & 63] |
            pc6[(f1 >>> 8) & 63] |
            pc8[63 & f1] |
            pc1[(f2 >>> 24) & 63] |
            pc3[(f2 >>> 16) & 63] |
            pc5[(f2 >>> 8) & 63] |
            pc7[63 & f2]);
        temp = left;
        left = right;
        right = temp;
      }
    }

    right = (right >>> 1) | (right << 31);
    right ^= temp =
      0x55555555 & (((left = (left >>> 1) | (left << 31)) >>> 1) ^ right);
    right ^= (temp = 0xff00ff & ((right >>> 8) ^ (left ^= temp << 1))) << 8;
    right ^= (temp = 0x33333333 & ((right >>> 2) ^ (left ^= temp))) << 2;
    right ^= temp = 0xffff & (((left ^= temp) >>> 16) ^ right);
    right ^= temp = 0xf0f0f0f & (((left ^= temp << 16) >>> 4) ^ right);
    left ^= temp << 4;

    out += String.fromCharCode(
      left >>> 24,
      (left >>> 16) & 255,
      (left >>> 8) & 255,
      255 & left,
      right >>> 24,
      (right >>> 16) & 255,
      (right >>> 8) & 255,
      255 & right,
    );
  }
  return Buffer.from(out, "binary").toString("base64");
}

function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

function calcDataSign(obj) {
  function serialize(val) {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const keys = Object.keys(val).sort();
      return keys
        .map((k) => {
          const sub = val[k];
          if (typeof sub === "number") {
            return serialize("" + 10000 * sub);
          }
          return serialize("" + sub);
        })
        .join("");
    }
    return val ? val.toString() : "";
  }
  return md5(serialize(obj));
}

// ==========================================
// 2. MÃ HÓA AES-CBC ZERO-PADDING & RSA
// ==========================================
function aesEncryptZeroPadding(plainBuffer, keyHex) {
  const key = Buffer.from(keyHex, "utf8");
  const iv = Buffer.from("0102030405060708", "utf8");

  const padLen = (16 - (plainBuffer.length % 16)) % 16;
  const padded =
    padLen > 0
      ? Buffer.concat([plainBuffer, Buffer.alloc(padLen, 0)])
      : plainBuffer;

  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return encrypted.toString("hex");
}

function rsaEncrypt(text, publicKey) {
  let pem = publicKey.trim();
  if (!pem.startsWith("-----BEGIN")) {
    pem = `-----BEGIN PUBLIC KEY-----\n${pem.match(/.{1,64}/g).join("\n")}\n-----END PUBLIC KEY-----`;
  }
  const encrypted = crypto.publicEncrypt(
    {
      key: pem,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(text, "utf8"),
  );
  return encrypted.toString("hex");
}

// ==========================================
// 3. XÂY DỰNG REQUEST BODY CỦA SHUMEI
// ==========================================
function buildRequestBody(conf) {
  const org = conf.organization;
  const appId = conf.appId || "default";
  const pubKey = conf.publicKey;

  const uid = crypto.randomUUID();
  const priId = md5(uid).slice(0, 16);
  const ep = rsaEncrypt(uid, pubKey);

  const now = new Date();
  const timeStr =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");
  const localUid = crypto.randomUUID();
  const smidPrefix = timeStr + md5(localUid) + "00";
  const smidSign = md5("smsk_web_" + smidPrefix).slice(0, 14);
  const localSmid = smidPrefix + smidSign + "0";

  const payload = {
    protocol: 279,
    cm: des_sm(org, "bek5y8ck"),
    og: des_sm(appId, "17vnhxoy"),
    ki: des_sm("web", "mbmwo0og"),
    version: "3.0.0",
    ek: des_sm("3.0.0", "41uq54np"),
    kd: "",
    xy: des_sm("all", "hefiudnj"),
    smid: localSmid,
    yp: des_sm("1.0.0", "8dm48zka"),
    // Thời gian trôi qua từ khi tải script đến khi gửi (khoảng 30ms - 80ms)
    yi: des_sm(String(Math.floor(Math.random() * 50 + 30)), "ncdmk4ad"),
    sc: des_sm("-", "nndx05dv"), // Chrome hiện đại ẩn plugin, trả về rỗng hoặc "-"

    // User-Agent Chrome 126+ trên Windows 64-bit
    xo: des_sm(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
      "4m15b11j",
    ),

    // Hash Canvas 2D đặc trưng của Chrome/Windows
    vr: des_sm("b78a9c3e", "jl8yq352"),

    // Timezone offset tính theo phút (VN là UTC+7 -> -420)
    ic: des_sm(String(new Date().getTimezoneOffset()), "ihaoil6z"),

    // Platform chuẩn trên Chrome Windows luôn là Win32
    tt: des_sm("Win32", "kn6oyjo4"),

    // URL trang hiện tại
    wl: des_sm("https://chat.deepseek.com/sign_in", "j54lcv3c"),
    eb: des_sm("", "d9fd217d"), // Referrer (rỗng nếu truy cập trực tiếp)

    // Độ phân giải màn hình: width_height_colorDepth_pixelRatio
    vx: des_sm("1920_1080_24_1", "q5g3kuj3"),

    // Tọa độ và kích thước: [screenLeft, screenTop, clientWidth, clientHeight, width, height, availWidth, availHeight]
    // 0_0_1920_927_1920_1080_1920_1032 đại diện cho cửa sổ full screen trên Win 11
    lp: des_sm("0_0_1920_927_1920_1080_1920_1032", "6wvopcsc"),

    // Flag: [Flash=0, Automation=0, DevTools=0, CookieEnabled=1]
    fu: des_sm("0001", "a3l1z50h"),

    // ID ngẫu nhiên & Timestamp thu thập
    aw: des_sm(crypto.randomUUID(), "8kzyjl46"),
    hk: des_sm(String(Date.now()), "2emikljv"),
    jt: des_sm(crypto.randomUUID(), "qikfxkpr"),
    xv: des_sm(String(Date.now()), "uve4ek1b"),

    // Các chỉ số phần cứng & trạng thái hệ thống
    cdp: 0,
    maxTouchPoints: 0, // Desktop Windows không có màn hình cảm ứng
    connectionRtt: 50, // RTT mạng (ms)
    cpucount: 8, // Số luồng CPU phổ biến (8, 12 hoặc 16)
    battery: { charging: 1, level: 1 }, // Thiết bị cắm sạc/desktop
    incognito: { browserName: "Chrome" },
    t: Date.now(),
    collectTime: Math.floor(Math.random() * 15 + 20), // Khoảng 20-35ms
  };
  payload.er = des_sm(calcDataSign(payload), "2j48yowr");

  const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
  const aesData = aesEncryptZeroPadding(gzipped, priId);

  return {
    appId: appId,
    organization: org,
    ep: ep,
    data: aesData,
    os: "web",
    encode: 5,
    compress: 2,
  };
}

// ==========================================
// 4. HÀM GỬI HTTP VÀ NHẬN DEVICE ID TỪ SERVER
// ==========================================
async function fetchDeviceId(conf) {
  const bodyObj = buildRequestBody(conf);
  const apiHost = conf.apiHost || "fp-it.portal101.cn";
  const apiPath = conf.apiPath || "/deviceprofile/v4";

  try {
    const { data: result } = await axios.post(
      `https://${apiHost}${apiPath}`,
      bodyObj,
      {
        headers: {
          "Content-Type": "application/json;charset=utf-8",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
        },
      },
    );

    console.log(result);

    // Server Shumei thành công trả về code: 1100 (tương đương hex 0x44c)
    if (result && (result.code === 1100 || result.code === 0x44c)) {
      return result.detail?.deviceId || "";
    }

    throw new Error(
      `API Error - Code: ${result ? result.code : "unknown"}, Message: ${result ? result.message : "unknown"}`,
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("API Error -"))
      throw err;
    throw new Error(`Request failed: ${err.message}`, { cause: err });
  }
}

// ==========================================
// 5. THỰC THI THỬ NGHIỆM
// ==========================================
const conf = {
  organization: "P9usCUBauxft8eAmUXaZ",
  appId: "default",
  publicKey:
    "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDetfEgYD4aE1ZjmWJ6/jnPurhzI+yeRoJHWrnNtQMte3stQ4VjG3yu21FuN75E6cDpA9KtDXwcB2M/FiGUAe3G0rNotbWI8+SjZfUbW/OILFTzY0uaeEkmVGW5WyJ6weQbbr1xTCPa2OO3YIMeZljWUYHG5h21WAm/PATg8im8cQIDAQAB",
  staticHost: "chat.deepseek.com",
  protocol: "https",
  apiHost: "fp-it-acc.portal101.cn",
  apiPath: "/deviceprofile/v4",
};

fetchDeviceId(conf)
  .then((deviceId) => {
    console.log("[SUCCESS] Device ID:", deviceId);
  })
  .catch((err) => {
    console.error("[ERROR]", err.message);
  });
