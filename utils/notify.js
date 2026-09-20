const Reminder = require("../models/Reminder");
const User = require("../models/User");
const { sendSms, SMS_TYPES } = require("./sms");
const { sendPush } = require("./push");

/**
 * Puts a message in a farmer's bell (Reminders), and — if they have a phone registered for push, or opted in to
 * SMS — sends it there too. Safe to call twice with the same dedupeKey: the second call does nothing at all.
 */
async function notifyFarmer(farmerId, { type, title, message, dedupeKey, cropType = "General" }) {
  try {
    await Reminder.create({ farmer: farmerId, timelineRef: "general", cropType, type, title, message, dedupeKey });
  } catch (error) {
    if (error && error.code === 11000) return false;
    console.error("notifyFarmer failed:", error.message);
    return false;
  }
  try {
    await sendPush(farmerId, { title, body: message });
    if (SMS_TYPES.includes(type)) {
      const user = await User.findById(farmerId).select("phone smsAlerts");
      if (user && user.smsAlerts) await sendSms(user, type, `AgriLink: ${title}. ${message}`);
    }
  } catch (error) {
    console.error("notify delivery failed:", error.message);
  }
  return true;
}

module.exports = { notifyFarmer };
