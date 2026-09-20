const express = require("express");
const router = express.Router();
const { getMetrics } = require("../controllers/adminController");
const { getImpact, getMarketHeatmap } = require("../controllers/impactController");
const { listReports, getMediaForAdmin, removeMessage, restoreMessage, banUser, chatStats } = require("../controllers/chatModerationController");
const survey = require("../controllers/surveyController");
const safety = require("../controllers/safetyController");
const community = require("../controllers/communityController");
const records = require("../controllers/recordsController");
const extras = require("../controllers/adminExtrasController");
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

// Trust & safety
router.get("/disputes", protect, requireRole("admin"), safety.adminDisputes);
router.post("/disputes/:id/message", protect, requireRole("admin"), safety.disputeMessage);
router.post("/disputes/:id/resolve", protect, requireRole("admin"), safety.resolveDispute);
router.get("/reports", protect, requireRole("admin"), safety.adminReports);
router.patch("/reports/:id", protect, requireRole("admin"), safety.setReportStatus);
router.get("/feedback", protect, requireRole("admin"), safety.adminFeedback);
router.patch("/feedback/:id", protect, requireRole("admin"), safety.setFeedbackStatus);
router.get("/verifications", protect, requireRole("admin"), safety.adminVerifications);
router.post("/verifications/:userId", protect, requireRole("admin"), safety.decideVerification);
router.get("/photos/:id", protect, requireRole("admin"), safety.viewPhoto);

// Agriculture offices, officers, support prices
router.post("/offices", protect, requireRole("admin"), community.createOffice);
router.patch("/offices/:id", protect, requireRole("admin"), community.updateOffice);
router.delete("/offices/:id", protect, requireRole("admin"), community.deleteOffice);
router.post("/users/:id/officer", protect, requireRole("admin"), community.setOfficer);
router.post("/support-prices", protect, requireRole("admin"), records.publishSupportPrice);
router.delete("/support-prices/:id", protect, requireRole("admin"), records.removeSupportPrice);

// System health, impact, referrals
router.get("/system", protect, requireRole("admin"), extras.systemHealth);
router.get("/users/search", protect, requireRole("admin"), extras.searchUsers);
router.get("/impact/districts", protect, requireRole("admin"), extras.districtImpact);
router.get("/referrals", protect, requireRole("admin"), extras.referralBoard);

router.get("/chat/stats", protect, requireRole("admin"), chatStats);
router.get("/chat/reports", protect, requireRole("admin"), listReports);
router.get("/chat/media/:id", protect, requireRole("admin"), getMediaForAdmin);
router.post("/chat/messages/remove", protect, requireRole("admin"), removeMessage);
router.post("/chat/messages/restore", protect, requireRole("admin"), restoreMessage);
router.post("/chat/ban", protect, requireRole("admin"), banUser);

module.exports = router;
