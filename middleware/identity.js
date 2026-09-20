const mongoose = require("mongoose");

// Older endpoints let the CLIENT say who it is (farmer, buyerId, driverId...). That means anyone could
// pretend to be someone else. bindIdentity() runs after login: if a request claims to be a different
// person than its login token, it is refused. Admins may act on behalf of others.
const IDENTITY_FIELDS = ["farmer", "farmerId", "driver", "driverId", "buyer", "buyerId", "investor", "investorId", "confirmedBy", "rejectedBy", "orderedBy"];

function bindIdentity(req, res, next) {
  if (req.userRole === "admin") return next();
  for (const source of [req.body, req.query]) {
    if (!source || typeof source !== "object") continue;
    for (const field of IDENTITY_FIELDS) {
      const value = source[field];
      if (value === undefined || value === null || value === "") continue;
      if (String(value) !== String(req.userId)) {
        return res.status(403).json({ success: false, message: "You can only act as yourself." });
      }
    }
  }
  next();
}

// The record in :id must belong to the logged-in person (via the given field), unless they are an admin.
function ownerOf(Model, field) {
  return async function (req, res, next) {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id." });
      const doc = await Model.findById(req.params.id).select(field).lean();
      if (!doc) return res.status(404).json({ success: false, message: "Not found." });
      if (req.userRole !== "admin" && String(doc[field]) !== String(req.userId)) {
        return res.status(403).json({ success: false, message: "This is not yours." });
      }
      next();
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed." });
    }
  };
}

module.exports = { bindIdentity, ownerOf, IDENTITY_FIELDS };
