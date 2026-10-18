const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * Verifies the Authorization: Bearer <token> header and attaches
 * req.userId / req.userRole for downstream route handlers.
 */
function protect(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "No authentication token provided." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
}

/**
 * Restricts a route to specific roles, e.g. requireRole("admin").
 * Use after `protect` in the middleware chain.
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.userRole)) {
      return res.status(403).json({ success: false, message: "You do not have permission to perform this action." });
    }
    next();
  };
}

/**
 * Server-side enforcement for "an unapproved driver can't actually use
 * the account" — this is the real gate, not just the app's UI politely
 * hiding buttons. Apply it after requireRole("driver") on any action
 * that matters: registering/updating a lorry, going on duty, accepting
 * cargo. Admin can still do admin things regardless (not relevant here
 * since this only guards driver-role routes, but kept symmetric with the
 * rest of the codebase's style).
 */
async function requireVerifiedDriver(req, res, next) {
  try {
    const user = await User.findById(req.userId).select("verification");
    if (!user || user.verification?.status !== "verified") {
      const status = user?.verification?.status || "pending";
      return res.status(403).json({
        success: false,
        code: "driver_not_verified",
        verificationStatus: status,
        message: status === "rejected"
          ? "Your driver application wasn't approved, so this isn't available yet."
          : "This isn't available until an admin approves your driver documents.",
      });
    }
    next();
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not check your driver approval status." });
  }
}

module.exports = { protect, requireRole, requireVerifiedDriver };
