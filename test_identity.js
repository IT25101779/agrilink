// TEST-ONLY. Old endpoints used to be open; they now need a login. Older tests sent no token, so for the
// routes that were locked down this attaches a token matching the identity in the request (body or query).
// Routes that were never open (and tests that expect "401 without login") are left alone.
const jwt = require("jsonwebtoken");
const OLD_OPEN = ["/marketplace", "/logistics", "/crowdfunding", "/community-listings", "/reminders", "/timelines", "/chat/", "/disease", "/suppliers/nearby"];
const FIELDS = ["farmer", "farmerId", "driver", "driverId", "buyer", "buyerId", "investor", "investorId", "confirmedBy", "rejectedBy", "orderedBy"];
const roles = {};
function autoToken(path, body) {
  if (!OLD_OPEN.some((p) => path.startsWith(p))) return undefined;
  const query = new URLSearchParams(path.split("?")[1] || "");
  let id;
  for (const f of FIELDS) { id = (body && body[f]) || query.get(f); if (id) break; }
  return jwt.sign({ userId: String(id || "000000000000000000000001"), role: roles[String(id)] || "farmer" }, process.env.JWT_SECRET || "s", { expiresIn: "1h" });
}
module.exports = { autoToken, roles };
