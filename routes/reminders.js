const express = require("express");
const { protect, requireRole } = require("../middleware/authMiddleware");
const { bindIdentity, ownerOf } = require("../middleware/identity");
const Reminder = require("../models/Reminder");
const router = express.Router();
const { generateReminders, getReminders, updateReminder } = require("../controllers/reminderController");

router.use(protect, bindIdentity);
router.post("/generate", generateReminders);
router.get("/", getReminders);
router.patch("/:id", ownerOf(Reminder, "farmer"), updateReminder);

module.exports = router;
