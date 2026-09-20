const express = require("express");
const { protect, requireRole } = require("../middleware/authMiddleware");
const router = express.Router();
const { verifyWebhook, receiveWebhook, dispatchPendingReminders } = require("../controllers/whatsappController");

// Meta calls GET once to verify the webhook URL, then POSTs every
// incoming message/status update to the same URL from then on.
router.get("/webhook", verifyWebhook);
router.post("/webhook", receiveWebhook);

// Triggered on a schedule by Vercel Cron (see vercel.json) — not meant
// to be called by a person or the mobile app.
router.post("/dispatch-reminders", protect, requireRole("admin"), dispatchPendingReminders);

module.exports = router;
