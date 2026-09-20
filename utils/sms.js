const SmsLog = require("../models/SmsLog");

const SMS_TYPES = ["order_update", "price_alert", "disease_risk", "wildlife"];
let fetchImpl = (...args) => fetch(...args); // replaceable in tests

function setFetch(fn) { fetchImpl = fn; }

/** 0771234567 / 94771234567 / +94 77 123 4567 -> +94771234567 */
function normalizePhone(phone) {
  let p = String(phone || "").replace(/[^\d+]/g, "");
  if (p.startsWith("+")) return p;
  if (p.startsWith("94")) return "+" + p;
  if (p.startsWith("0")) return "+94" + p.slice(1);
  return "+94" + p;
}

/**
 * Sends an SMS to a person who OPTED IN. Works with any gateway that accepts a JSON POST
 * ({ to, message, sender } with a Bearer token) — set SMS_GATEWAY_URL and SMS_GATEWAY_TOKEN.
 * Every message costs money, so each person is capped per month (SMS_MONTHLY_CAP, default 15).
 * Without a gateway configured nothing is sent (the attempt is logged as "skipped").
 */
async function sendSms(user, kind, text) {
  const month = new Date().toISOString().slice(0, 7);
  const log = (status, detail = "") => SmsLog.create({ user: user._id, kind, status, month, detail }).catch(() => {});
  if (!user || !user.smsAlerts) return { status: "skipped", detail: "not opted in" };
  const cap = parseInt(process.env.SMS_MONTHLY_CAP || "15", 10);
  if ((await SmsLog.countDocuments({ user: user._id, month, status: "sent" })) >= cap) { await log("skipped", "monthly cap"); return { status: "skipped", detail: "monthly cap" }; }
  const url = process.env.SMS_GATEWAY_URL;
  if (!url) { await log("skipped", "no gateway configured"); return { status: "skipped", detail: "no gateway configured" }; }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetchImpl(url, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", ...(process.env.SMS_GATEWAY_TOKEN ? { Authorization: `Bearer ${process.env.SMS_GATEWAY_TOKEN}` } : {}) }, body: JSON.stringify({ to: normalizePhone(user.phone), message: String(text).slice(0, 300), sender: process.env.SMS_SENDER || "AgriLink" }) });
    clearTimeout(timer);
    if (!res.ok) { await log("failed", `gateway said ${res.status}`); return { status: "failed", detail: `gateway said ${res.status}` }; }
    await log("sent");
    return { status: "sent" };
  } catch (error) {
    await log("failed", String(error.message).slice(0, 80));
    return { status: "failed", detail: error.message };
  }
}

module.exports = { sendSms, setFetch, normalizePhone, SMS_TYPES };
