const mongoose = require("mongoose");
const User = require("../models/User");
const TradeOrder = require("../models/TradeOrder");
const ReturnTrip = require("../models/ReturnTrip");
const WildlifeSighting = require("../models/WildlifeSighting");
const Question = require("../models/Question");
const ErrorLog = require("../models/ErrorLog");
const SmsLog = require("../models/SmsLog");
const Dispute = require("../models/Dispute");
const UserReport = require("../models/UserReport");
const Feedback = require("../models/Feedback");
const MarketplaceListing = require("../models/MarketplaceListing");

/** GET /api/admin/system — is everything healthy, and what needs the team's attention? */
async function systemHealth(req, res) {
  try {
    const day = new Date(Date.now() - 24 * 3600 * 1000), month = new Date().toISOString().slice(0, 7);
    const [errors24h, slow24h, recent, openDisputes, openReports, newFeedback, pendingVerifications, smsSent, smsFailed, users] = await Promise.all([
      ErrorLog.countDocuments({ kind: "error", at: { $gte: day } }), ErrorLog.countDocuments({ kind: "slow", at: { $gte: day } }),
      ErrorLog.find({}).sort({ at: -1 }).limit(10).lean(), Dispute.countDocuments({ status: "open" }), UserReport.countDocuments({ status: "open" }), Feedback.countDocuments({ status: "new" }),
      User.countDocuments({ "verification.status": "pending" }), SmsLog.countDocuments({ month, status: "sent" }), SmsLog.countDocuments({ month, status: "failed" }), User.find({ isActive: true }).select("role").lean(),
    ]);
    const byRole = {}; users.forEach((u) => { byRole[u.role] = (byRole[u.role] || 0) + 1; });
    return res.status(200).json({ success: true, data: { database: mongoose.connection.readyState === 1 ? "connected" : "problem", uptimeSeconds: Math.round(process.uptime()), errors24h, slow24h, recent: recent.map((e) => ({ at: e.at, method: e.method, path: e.path, status: e.status, ms: e.ms, message: e.message, kind: e.kind })), needsAttention: { openDisputes, openReports, newFeedback, pendingVerifications }, sms: { sentThisMonth: smsSent, failedThisMonth: smsFailed, gatewayConfigured: Boolean(process.env.SMS_GATEWAY_URL) }, pushConfigured: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT), users: byRole } });
  } catch (error) { console.error("systemHealth error:", error); return res.status(500).json({ success: false, message: "Failed." }); }
}

/** GET /api/admin/impact/districts — what the platform is doing in each district (real counts, no estimates). */
async function districtImpact(req, res) {
  try {
    const farmers = await User.find({ role: "farmer", isActive: true }).select("farmerProfile.district").lean();
    const districtOf = new Map(farmers.map((f) => [String(f._id), (f.farmerProfile && f.farmerProfile.district) || "Unknown"]));
    const rows = {};
    const row = (d) => (rows[d] = rows[d] || { district: d, farmers: 0, activeListings: 0, paidOrders: 0, soldKg: 0, soldLkr: 0, confirmedTruckBookings: 0, wildlifeReports7d: 0, openQuestions: 0 });
    farmers.forEach((f) => { row((f.farmerProfile && f.farmerProfile.district) || "Unknown").farmers++; });
    (await MarketplaceListing.find({ status: "listed" }).select("farmer").lean()).forEach((l) => { const d = districtOf.get(String(l.farmer)); if (d) row(d).activeListings++; });
    (await TradeOrder.find({ status: "paid" }).select("farmer quantityKg totalLkr").lean()).forEach((o) => { const d = districtOf.get(String(o.farmer)); if (d) { const r = row(d); r.paidOrders++; r.soldKg += o.quantityKg; r.soldLkr += o.totalLkr; } });
    (await ReturnTrip.find({}).select("bookings.farmer bookings.status").lean()).forEach((t) => t.bookings.forEach((b) => { const d = districtOf.get(String(b.farmer)); if (d && b.status === "confirmed") row(d).confirmedTruckBookings++; }));
    (await WildlifeSighting.find({ createdAt: { $gte: new Date(Date.now() - 7 * 86400000) } }).select("district").lean()).forEach((s) => { if (s.district) row(s.district).wildlifeReports7d++; });
    (await Question.find({ status: "open" }).select("district").lean()).forEach((q) => { row(q.district).openQuestions++; });
    const data = Object.values(rows).sort((a, b) => b.farmers - a.farmers);
    const total = data.reduce((t, r) => ({ farmers: t.farmers + r.farmers, paidOrders: t.paidOrders + r.paidOrders, soldKg: t.soldKg + r.soldKg, soldLkr: t.soldLkr + r.soldLkr }), { farmers: 0, paidOrders: 0, soldKg: 0, soldLkr: 0 });
    return res.status(200).json({ success: true, data, total });
  } catch (error) { console.error("districtImpact error:", error); return res.status(500).json({ success: false, message: "Failed." }); }
}

/** GET /api/admin/referrals — who is bringing new people in (village helpers and field agents). */
async function referralBoard(req, res) {
  const referred = await User.find({ referredBy: { $exists: true } }).select("referredBy role").lean();
  const counts = new Map();
  referred.forEach((u) => { const k = String(u.referredBy); const c = counts.get(k) || { total: 0, farmers: 0 }; c.total++; if (u.role === "farmer") c.farmers++; counts.set(k, c); });
  const people = await User.find({ _id: { $in: [...counts.keys()] } }).select("fullName role farmerProfile.district referralCode").lean();
  const data = people.map((p) => ({ name: p.fullName, role: p.role, district: p.farmerProfile && p.farmerProfile.district, code: p.referralCode, ...counts.get(String(p._id)) })).sort((a, b) => b.total - a.total).slice(0, 50);
  return res.status(200).json({ success: true, data, totalReferred: referred.length });
}

/** GET /api/admin/users/search?q= — find a person by name or email (used to make someone an officer). */
async function searchUsers(req, res) {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.status(400).json({ success: false, message: "Type at least 2 letters." });
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const users = await User.find({ isActive: true, $or: [{ fullName: rx }, { email: rx }] }).select("fullName email role farmerProfile.district officerProfile").limit(20).lean();
  return res.status(200).json({ success: true, data: users.map((u) => ({ id: String(u._id), name: u.fullName, email: u.email, role: u.role, district: u.farmerProfile && u.farmerProfile.district, officerDistricts: (u.officerProfile && u.officerProfile.districts) || [] })) });
}

module.exports = { systemHealth, districtImpact, referralBoard, searchUsers };
