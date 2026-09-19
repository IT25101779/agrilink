const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const {
  getMyPassport,
  rotatePassportLink,
  viewPassportPage,
  getPassportJson,
  getPassportQr,
} = require("../controllers/passportController");

// Farmer-only: see my passport, replace my share link.
router.get("/me", protect, requireRole("farmer"), getMyPassport);
router.post("/rotate", protect, requireRole("farmer"), rotatePassportLink);

// Public (no login) — anyone holding the secret link/QR can view it.
router.get("/view/:token", viewPassportPage);
router.get("/data/:token", getPassportJson);
router.get("/qr/:token", getPassportQr);

module.exports = router;
