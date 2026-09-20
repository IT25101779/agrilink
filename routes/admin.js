const express = require("express");
const router = express.Router();
const { getMetrics } = require("../controllers/adminController");
const { getImpact, getMarketHeatmap } = require("../controllers/impactController");
const { listReports, getMediaForAdmin, removeMessage, restoreMessage, banUser, chatStats } = require("../controllers/chatModerationController");
const survey = require("../controllers/surveyController");
const prices = require("../controllers/priceController");
const { protect, requireRole } = require("../middleware/authMiddleware");

router.get("/metrics", protect, requireRole("admin"), getMetrics);
router.get("/impact", protect, requireRole("admin"), getImpact);
router.get("/market-heatmap", protect, requireRole("admin"), getMarketHeatmap);

// Group-chat moderation (admins only — they alone can see who sent a message)
// Surveys: real farmer answers -> real numbers (admin only)
router.get("/surveys", protect, requireRole("admin"), survey.listSurveys);
router.post("/surveys", protect, requireRole("admin"), survey.createSurvey);
router.patch("/surveys/:id", protect, requireRole("admin"), survey.setSurveyActive);
router.get("/surveys/:id/results", protect, requireRole("admin"), survey.surveyResults);
router.get("/surveys/:id/export", protect, requireRole("admin"), survey.surveyCsv);

// Official daily market prices (also fires the price alerts)
router.post("/prices", protect, requireRole("admin"), prices.publishPrices);

router.get("/chat/stats", protect, requireRole("admin"), chatStats);
router.get("/chat/reports", protect, requireRole("admin"), listReports);
router.get("/chat/media/:id", protect, requireRole("admin"), getMediaForAdmin);
router.post("/chat/messages/remove", protect, requireRole("admin"), removeMessage);
router.post("/chat/messages/restore", protect, requireRole("admin"), restoreMessage);
router.post("/chat/ban", protect, requireRole("admin"), banUser);

module.exports = router;
