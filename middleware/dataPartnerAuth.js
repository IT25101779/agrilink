const DataPartner = require("../models/DataPartner");

/**
 * Authenticates a DATA-AS-A-SERVICE partner by API key (header "X-Api-Key",
 * or ?apiKey= for a quick test in a browser). This is a separate identity
 * scheme from the normal farmer/buyer JWT login (middleware/authMiddleware)
 * because partners are outside organizations, not AgriLink user accounts.
 */
async function requireDataPartnerKey(req, res, next) {
  try {
    const key = req.header("X-Api-Key") || req.query.apiKey;
    if (!key) return res.status(401).json({ success: false, message: "Missing API key. Send it as the X-Api-Key header." });
    const partner = await DataPartner.findOne({ apiKey: key, isActive: true });
    if (!partner) return res.status(401).json({ success: false, message: "Invalid or inactive API key." });
    partner.lastUsedAt = new Date();
    partner.save().catch(() => {}); // best-effort, never blocks the request
    req.dataPartner = partner;
    return next();
  } catch (error) {
    console.error("requireDataPartnerKey error:", error);
    return res.status(500).json({ success: false, message: "Authentication failed." });
  }
}

module.exports = { requireDataPartnerKey };
