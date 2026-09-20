const Reminder = require("../models/Reminder");

/**
 * Puts a message in a farmer's bell (Reminders). Safe to call twice with the
 * same dedupeKey — the second call is silently ignored.
 */
async function notifyFarmer(farmerId, { type, title, message, dedupeKey, cropType = "General" }) {
  try {
    await Reminder.create({ farmer: farmerId, timelineRef: "general", cropType, type, title, message, dedupeKey });
    return true;
  } catch (error) {
    if (error && error.code === 11000) return false;
    console.error("notifyFarmer failed:", error.message);
    return false;
  }
}

module.exports = { notifyFarmer };
