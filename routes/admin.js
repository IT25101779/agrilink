const express = require("express");
const router = express.Router();
const { getMetrics } = require("../controllers/adminController");
const { getImpact, getMarketHeatmap } = require("../controllers/impactController");
const { protect, requireRole } = require("../middleware/authMiddleware");

router.get("/metrics", protect, requireRole("admin"), getMetrics);
router.get("/impact", protect, requireRole("admin"), getImpact);
router.get("/market-heatmap", protect, requireRole("admin"), getMarketHeatmap);

module.exports = router;
