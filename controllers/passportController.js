const crypto = require("crypto");
const QRCode = require("qrcode");
const User = require("../models/User");
const { buildPassport, renderPassportHtml, escapeHtml } = require("../utils/passportData");

const TOKEN_REGEX = /^[a-f0-9]{24}$/;

function newToken() {
  return crypto.randomBytes(12).toString("hex"); // 24 hex chars, 96 bits of randomness
}

/** https://host — honours the proxy header Vercel adds. */
function baseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
}

function linksFor(req, token) {
  const base = baseUrl(req);
  return {
    shareUrl: `${base}/api/passport/view/${token}`,
    qrUrl: `${base}/api/passport/qr/${token}`,
  };
}

/** Returns the farmer's share token, creating one on first use. */
async function ensureToken(userId) {
  const existing = await User.findById(userId).select("+passportToken");
  if (!existing) return null;
  if (existing.passportToken) return existing.passportToken;

  const token = newToken();
  await User.updateOne({ _id: userId }, { $set: { passportToken: token } });
  return token;
}

/**
 * GET /api/passport/me   (logged-in farmer)
 * The farmer's passport data plus the link and QR image for sharing it.
 */
async function getMyPassport(req, res) {
  try {
    const passport = await buildPassport(req.userId);
    if (!passport) return res.status(404).json({ success: false, message: "User not found." });

    const token = await ensureToken(req.userId);
    return res.status(200).json({ success: true, data: { passport, ...linksFor(req, token) } });
  } catch (error) {
    console.error("getMyPassport error:", error);
    return res.status(500).json({ success: false, message: "Failed to load your Farm Passport." });
  }
}

/**
 * POST /api/passport/rotate   (logged-in farmer)
 * Creates a brand-new random share code. Every link or QR shared before this
 * stops working immediately — for when a passport was shared by mistake.
 */
async function rotatePassportLink(req, res) {
  try {
    const token = newToken();
    const result = await User.updateOne({ _id: req.userId }, { $set: { passportToken: token } });
    if (!result.matchedCount) return res.status(404).json({ success: false, message: "User not found." });
    return res.status(200).json({ success: true, message: "New link created. Old links no longer work.", data: linksFor(req, token) });
  } catch (error) {
    console.error("rotatePassportLink error:", error);
    return res.status(500).json({ success: false, message: "Failed to create a new link." });
  }
}

async function findUserIdByToken(token) {
  if (!TOKEN_REGEX.test(String(token))) return null;
  const user = await User.findOne({ passportToken: token }).select("_id");
  return user ? user._id : null;
}

function invalidPage(res) {
  return res
    .status(404)
    .type("html")
    .send(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Passport not found</title>` +
        `<body style="font-family:sans-serif;text-align:center;padding:48px 20px;color:#1F2A24"><h2>${escapeHtml("This passport link is no longer valid")}</h2>` +
        `<p style="color:#6C7B72">The farmer may have replaced it with a new link. Ask them to share the current one.</p></body>`
    );
}

/**
 * GET /api/passport/view/:token   (public — no login)
 * The shareable web page.
 */
async function viewPassportPage(req, res) {
  try {
    const userId = await findUserIdByToken(req.params.token);
    if (!userId) return invalidPage(res);

    const passport = await buildPassport(userId);
    if (!passport) return invalidPage(res);

    const { qrUrl } = linksFor(req, req.params.token);
    res.set("Cache-Control", "no-store");
    return res.status(200).type("html").send(renderPassportHtml(passport, { qrUrl }));
  } catch (error) {
    console.error("viewPassportPage error:", error);
    return res.status(500).type("html").send("<p>Something went wrong. Please try again.</p>");
  }
}

/**
 * GET /api/passport/data/:token   (public — no login)
 * The same passport as JSON, for lenders' systems.
 */
async function getPassportJson(req, res) {
  try {
    const userId = await findUserIdByToken(req.params.token);
    if (!userId) return res.status(404).json({ success: false, message: "Passport link is not valid." });
    const passport = await buildPassport(userId);
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ success: true, data: passport });
  } catch (error) {
    console.error("getPassportJson error:", error);
    return res.status(500).json({ success: false, message: "Failed to load passport." });
  }
}

/**
 * GET /api/passport/qr/:token   (public — no login)
 * A PNG QR code that opens the passport page. Used by the app (as a plain
 * network image) and printed on the passport page itself.
 */
async function getPassportQr(req, res) {
  try {
    const userId = await findUserIdByToken(req.params.token);
    if (!userId) return res.status(404).json({ success: false, message: "Passport link is not valid." });

    const { shareUrl } = linksFor(req, req.params.token);
    const png = await QRCode.toBuffer(shareUrl, { type: "png", width: 512, margin: 1, errorCorrectionLevel: "M" });
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "no-store");
    return res.status(200).send(png);
  } catch (error) {
    console.error("getPassportQr error:", error);
    return res.status(500).json({ success: false, message: "Failed to create QR code." });
  }
}

module.exports = { getMyPassport, rotatePassportLink, viewPassportPage, getPassportJson, getPassportQr };
