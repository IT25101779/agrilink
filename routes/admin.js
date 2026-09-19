const express = require("express");
const router = express.Router();
const { getMetrics } = require("../controllers/adminController");
const { getImpact, getMarketHeatmap } = require("../controllers/impactController");
const { listReports, getMediaForAdmin, removeMessage, restoreMessage, banUser, chatStats } = require("../controllers/chatModerationController");
const { protect, requireRole } = require("../middleware/authMiddleware");

router.get("/metrics", protect, requireRole("admin"), getMetrics);
router.get("/impact", protect, requireRole("admin"), getImpact);
router.get("/market-heatmap", protect, requireRole("admin"), getMarketHeatmap);

// Group-chat moderation (admins only — they alone can see who sent a message)
router.get("/chat/stats", protect, requireRole("admin"), chatStats);
router.get("/chat/reports", protect, requireRole("admin"), listReports);
router.get("/chat/media/:id", protect, requireRole("admin"), getMediaForAdmin);
router.post("/chat/messages/remove", protect, requireRole("admin"), removeMessage);
router.post("/chat/messages/restore", protect, requireRole("admin"), restoreMessage);
router.post("/chat/ban", protect, requireRole("admin"), banUser);

module.exports = router;
