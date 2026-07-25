const express = require("express");
const router = express.Router();
const { generateReminders, getReminders, updateReminder } = require("../controllers/reminderController");

router.post("/generate", generateReminders);
router.get("/", getReminders);
router.patch("/:id", updateReminder);

module.exports = router;
