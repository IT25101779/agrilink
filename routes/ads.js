const express = require("express");
const router = express.Router();
const { createAd, getAds, updateAd, deleteAd, trackImpression, trackClick } = require("../controllers/adController");
const { protect, requireRole } = require("../middleware/authMiddleware");

router.get("/", getAds);
router.post("/", protect, requireRole("admin"), createAd);
router.patch("/:id", protect, requireRole("admin"), updateAd);
router.delete("/:id", protect, requireRole("admin"), deleteAd);
router.post("/:id/impression", trackImpression);
router.post("/:id/click", trackClick);

module.exports = router;
