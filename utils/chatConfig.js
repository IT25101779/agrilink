const crypto = require("crypto");
const { SHELF_LIFE_DAYS } = require("./shelfLife");

/**
 * GROUP CHAT — rules that are shared by the server code and its tests:
 * which groups exist, how anonymous aliases are made, and what a message
 * may contain.
 */

const DISTRICTS = [
  "Ampara", "Anuradhapura", "Badulla", "Batticaloa", "Colombo", "Galle", "Gampaha", "Hambantota", "Jaffna",
  "Kalutara", "Kandy", "Kegalle", "Kilinochchi", "Kurunegala", "Mannar", "Matale", "Matara", "Monaragala",
  "Mullaitivu", "Nuwara Eliya", "Polonnaruwa", "Puttalam", "Ratnapura", "Trincomalee", "Vavuniya",
];

// The same 51 crop names the mobile app's crop catalogue uses.
const CROPS = Object.keys(SHELF_LIFE_DAYS);

const DISTRICT_LOOKUP = Object.fromEntries(DISTRICTS.map((d) => [d.toLowerCase(), d]));
const CROP_LOOKUP = Object.fromEntries(CROPS.map((c) => [c.toLowerCase(), c]));

const LIMITS = {
  textMaxChars: 1000,
  imageMaxBytes: 600 * 1024,
  voiceMaxBytes: 450 * 1024,
  voiceMaxSeconds: 90,
  messagesPerMinute: 15,
  mediaPerMinute: 4,
  autoHideAtReports: 3, // distinct reporters that hide a message until an admin decides
  pageSize: 40,
  maxPageSize: 100,
};

const REPORT_REASONS = ["abuse", "spam", "personal_info", "unsafe_image", "other"];

function canonicalDistrict(name) {
  return DISTRICT_LOOKUP[String(name || "").trim().toLowerCase()] || null;
}

function canonicalCrop(name) {
  return CROP_LOOKUP[String(name || "").trim().toLowerCase()] || null;
}

/** Builds the key for a group: all | district:X | crop:Y | cropdist:Y|X (null if a name is not valid). */
function buildGroupKey({ district, crop }) {
  const d = district ? canonicalDistrict(district) : null;
  const c = crop ? canonicalCrop(crop) : null;
  if (district && !d) return null;
  if (crop && !c) return null;
  if (d && c) return `cropdist:${c}|${d}`;
  if (d) return `district:${d}`;
  if (c) return `crop:${c}`;
  return "all";
}

/** Turns a key back into { key, scope, district, crop } — or null when it is not a real group. */
function parseGroupKey(key) {
  const text = String(key || "");
  if (text === "all") return { key: "all", scope: "all", district: null, crop: null };
  if (text.startsWith("district:")) {
    const d = canonicalDistrict(text.slice(9));
    return d ? { key: `district:${d}`, scope: "district", district: d, crop: null } : null;
  }
  if (text.startsWith("crop:")) {
    const c = canonicalCrop(text.slice(5));
    return c ? { key: `crop:${c}`, scope: "crop", district: null, crop: c } : null;
  }
  if (text.startsWith("cropdist:")) {
    const [cropName, districtName] = text.slice(9).split("|");
    const c = canonicalCrop(cropName);
    const d = canonicalDistrict(districtName);
    return c && d ? { key: `cropdist:${c}|${d}`, scope: "cropdist", district: d, crop: c } : null;
  }
  return null;
}

/** From most specific to most general — what a filter of (district, crop) leads to. */
function groupChain({ district, crop }) {
  const d = district ? canonicalDistrict(district) : null;
  const c = crop ? canonicalCrop(crop) : null;
  const keys = [];
  if (d && c) keys.push(`cropdist:${c}|${d}`);
  if (c) keys.push(`crop:${c}`);
  if (d) keys.push(`district:${d}`);
  keys.push("all");
  return keys.map(parseGroupKey);
}

// ---------------- anonymous aliases ----------------

const ADJECTIVES = ["Bright", "Green", "Golden", "Calm", "Brave", "Swift", "Gentle", "Sunny", "Wise", "Happy", "Proud", "Kind",
  "Lucky", "Merry", "Quiet", "Sturdy", "Fresh", "Misty", "Rainy", "Early", "Humble", "Eager", "Steady", "Cheerful"];
const NOUNS = ["Mango", "Paddy", "Lotus", "Peacock", "Coconut", "Monsoon", "Sunrise", "Banyan", "Jasmine", "Kingfisher", "Cinnamon", "Tea Leaf",
  "Harvest", "Meadow", "Orchid", "Firefly", "Lagoon", "Rambutan", "Turmeric", "Swallow", "Ginger", "Sapphire", "Papaya", "Butterfly"];
const EMOJIS = ["🌱", "🌾", "🥭", "🌴", "🪷", "🦚", "🌻", "🍃", "🌶️", "🍅", "🥕", "🐝", "🦋", "🌿", "☀️", "🌧️"];

function aliasSecret() {
  return process.env.CHAT_ALIAS_SECRET || process.env.JWT_SECRET || "agrilink-chat";
}

/**
 * The same farmer always gets the same alias inside one group, but a
 * different alias in every other group, so aliases can't be linked together.
 */
function makeAlias(userId, groupKey, salt = 0) {
  const h = crypto.createHmac("sha256", aliasSecret()).update(`${userId}|${groupKey}|${salt}`).digest();
  return {
    alias: `${ADJECTIVES[h[0] % ADJECTIVES.length]} ${NOUNS[h[1] % NOUNS.length]} ${1000 + (h.readUInt16BE(2) % 9000)}`,
    avatarHue: h.readUInt16BE(4) % 360,
    avatarEmoji: EMOJIS[h[6] % EMOJIS.length],
  };
}

// ---------------- what a message may contain ----------------

// Starter list only — extend it with your team's own words (any language).
// Sinhala / Tamil are matched anywhere in the text (those scripts don't put
// spaces around every word); English is matched as whole words.
const BLOCKED_WORDS_LATIN = ["fuck", "fucking", "shit", "bitch", "bastard", "asshole", "dick", "pussy", "slut", "whore", "cunt", "idiot", "stupid"];
const BLOCKED_WORDS_SINHALA = ["හුත්ති", "හුත්තා", "පකයා", "පක", "වේසි", "බැල්ලි", "කැරියා"];
const BLOCKED_WORDS_TAMIL = ["தேவடியா", "புண்டை", "ஓழ்", "பூல்", "சூத்து", "நாயே", "தாயோளி"];

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

function normalise(text) {
  return String(text || "").replace(ZERO_WIDTH, "").normalize("NFC");
}

/**
 * Returns { ok: true } or { ok: false, code } where code is one of
 * phone | email | link | profanity | spam — the app shows a friendly,
 * translated explanation for each.
 */
function checkContent(rawText) {
  const text = normalise(rawText);
  if (!text.trim()) return { ok: true };

  // Sri Lankan phone numbers: 07x xxx xxxx, +94 7x..., or any run of 9+ digits with spaces/dashes.
  const digitsOnly = text.replace(/(?<=\d)[\s\-.()](?=\d)/g, "");
  // (spaces alone don't count as a separator for the generic rule, so "price 300 250 200" is fine)
  const glued = text.replace(/(?<=\d)[\-.()](?=\d)/g, "");
  if (/(\+?94|0)7\d{8}/.test(digitsOnly) || /(^|\D)0\d{9}(\D|$)/.test(digitsOnly) || /\d{9,}/.test(glued)) return { ok: false, code: "phone" };
  // real "@", or the usual ways people disguise it: (at) / [at], or naming a mail service
  if (/[A-Za-z0-9._%+-]+\s?(@|\(at\)|\[at\])\s?[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i.test(text) || /\b(gmail|yahoo|hotmail|outlook)\b/i.test(text)) return { ok: false, code: "email" };
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|lk|net|org|info|xyz|me|io)\b)/i.test(text)) return { ok: false, code: "link" };

  const lower = text.toLowerCase();
  for (const word of BLOCKED_WORDS_LATIN) {
    if (new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, "i").test(lower)) return { ok: false, code: "profanity" };
  }
  for (const word of [...BLOCKED_WORDS_SINHALA, ...BLOCKED_WORDS_TAMIL]) {
    if (text.includes(word)) return { ok: false, code: "profanity" };
  }

  // Shouting the same character over and over, or pasting the same word again and again.
  if (/(.)\1{11,}/u.test(text)) return { ok: false, code: "spam" };
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length >= 8 && new Set(words).size <= Math.ceil(words.length / 5)) return { ok: false, code: "spam" };

  return { ok: true };
}

function cleanText(rawText, max = LIMITS.textMaxChars) {
  return normalise(rawText).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

// ---------------- upload checks (look at the real bytes, not just what the app claims) ----------------

function sniffImage(buffer) {
  if (buffer.length > 12 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length > 8 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length > 12 && buffer.slice(0, 4).toString() === "RIFF" && buffer.slice(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

function sniffAudio(buffer) {
  if (buffer.length > 12 && buffer.slice(4, 8).toString() === "ftyp") return "audio/mp4"; // .m4a / AAC in MP4
  if (buffer.length > 4 && buffer.slice(0, 4).toString() === "OggS") return "audio/ogg";
  if (buffer.length > 12 && buffer.slice(0, 4).toString() === "RIFF" && buffer.slice(8, 12).toString() === "WAVE") return "audio/wav";
  if (buffer.length > 3 && buffer.slice(0, 3).toString() === "ID3") return "audio/mpeg";
  if (buffer.length > 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return "audio/aac"; // ADTS AAC
  if (buffer.length > 5 && buffer.slice(0, 6).toString() === "#!AMR\n") return "audio/amr";
  return null;
}

module.exports = {
  DISTRICTS, CROPS, LIMITS, REPORT_REASONS,
  canonicalDistrict, canonicalCrop, buildGroupKey, parseGroupKey, groupChain,
  makeAlias, checkContent, cleanText, sniffImage, sniffAudio,
};
