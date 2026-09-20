const express = require("express");
const router = express.Router();
const { limiter } = require("../middleware/rateLimit");
const trackLimiter = limiter({ windowMs: 60 * 1000, max: parseInt(process.env.RATE_LIMIT_ADTRACK || "60", 10) }); // stops anyone inflating ad numbers
const { createAd, getAds, updateAd, deleteAd, trackImpression, trackClick } = require("../controllers/adController");
const { protect, requireRole } = require("../middleware/authMiddleware");

router.get("/", getAds);
router.post("/", protect, requireRole("admin"), createAd);
router.patch("/:id", protect, requireRole("admin"), updateAd);
router.delete("/:id", protect, requireRole("admin"), deleteAd);
router.post("/:id/impression", trackLimiter, trackImpression);
router.post("/:id/click", trackLimiter, trackClick);

module.exports = router;
