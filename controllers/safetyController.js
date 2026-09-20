const mongoose = require("mongoose");
const Photo = require("../models/Photo");
const Dispute = require("../models/Dispute");
const UserReport = require("../models/UserReport");
const Block = require("../models/Block");
const Feedback = require("../models/Feedback");
const PaymentProfile = require("../models/PaymentProfile");
const TradeOrder = require("../models/TradeOrder");
const User = require("../models/User");
const { sniffImage, checkContent, cleanText } = require("../utils/chatConfig");
const { notifyFarmer } = require("../utils/notify");

const MAX_PHOTO_BYTES = 300 * 1024;
const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
const validId = (id) => mongoose.isValidObjectId(String(id));

function decodeImage(input) {
  const text = String(input || "").replace(/^data:[^;]+;base64,/, "");
  if (!text || !/^[A-Za-z0-9+/=\s]+$/.test(text)) return { error: "The photo could not be read." };
  const bytes = Buffer.from(text, "base64");
  if (bytes.length > MAX_PHOTO_BYTES) return { error: "This photo is too large. Please use a smaller one.", status: 413 };
  const mime = sniffImage(bytes);
  if (!mime) return { error: "Only JPEG, PNG or WebP photos are allowed." };
  return { bytes, mime };
}

async function blockedEither(a, b) {
  return Boolean(await Block.exists({ $or: [{ blocker: a, blocked: b }, { blocker: b, blocked: a }] }));
}

// ---------------- photos ----------------
async function orderParties(orderId) {
  if (!validId(orderId)) return null;
  return TradeOrder.findById(orderId).select("farmer buyer status").lean();
}
const isParty = (o, uid) => o && (String(o.farmer) === String(uid) || String(o.buyer) === String(uid));

/** POST /api/orders/:id/photos { imageBase64, label } — proof at pickup / delivery (max 6 per order). */
async function addOrderPhoto(req, res) {
  try {
    const order = await orderParties(req.params.id);
    if (!order) return fail(res, 404, "Order not found.");
    if (!isParty(order, req.userId)) return fail(res, 403, "This is not your order.");
    if (order.status === "cancelled" || order.status === "placed") return fail(res, 409, "Photos can be added after the order is accepted.");
    if ((await Photo.countDocuments({ purpose: "order", refId: order._id })) >= 6) return fail(res, 409, "This order already has 6 photos.");
    const img = decodeImage((req.body || {}).imageBase64);
    if (img.error) return fail(res, img.status || 400, img.error);
    const label = ["pickup", "delivery", "goods", "problem"].includes((req.body || {}).label) ? req.body.label : "goods";
    const photo = await Photo.create({ owner: req.userId, purpose: "order", refId: order._id, label, mime: img.mime, data: img.bytes, size: img.bytes.length });
    return res.status(201).json({ success: true, data: { id: String(photo._id), label } });
  } catch (error) { console.error("addOrderPhoto error:", error); return fail(res, 500, "Failed to save the photo."); }
}

async function listOrderPhotos(req, res) {
  const order = await orderParties(req.params.id);
  if (!order) return fail(res, 404, "Order not found.");
  if (!isParty(order, req.userId) && req.userRole !== "admin") return fail(res, 403, "This is not your order.");
  const photos = await Photo.find({ purpose: "order", refId: order._id }).select("owner label createdAt").sort({ createdAt: 1 }).lean();
  return res.status(200).json({ success: true, data: photos.map((p) => ({ id: String(p._id), label: p.label, mine: String(p.owner) === String(req.userId), at: p.createdAt })) });
}

/** GET /api/photos/:id — who may look depends on what the photo is for. */
async function viewPhoto(req, res) {
  try {
    if (!validId(req.params.id)) return fail(res, 400, "Invalid photo.");
    const photo = await Photo.findById(req.params.id);
    if (!photo) return fail(res, 404, "No photo.");
    const uid = String(req.userId), isAdmin = req.userRole === "admin";
    let allowed = isAdmin || String(photo.owner) === uid;
    if (!allowed && (photo.purpose === "order" || photo.purpose === "dispute")) allowed = isParty(await orderParties(photo.refId), uid);
    if (!allowed && photo.purpose === "payment_qr") allowed = Boolean(await TradeOrder.exists({ farmer: photo.owner, buyer: req.userId, status: { $in: ["accepted", "dispatched", "delivered", "paid"] } }));
    if (!allowed) return fail(res, 403, "You can't view this photo.");
    res.set("Content-Type", photo.mime); res.set("Cache-Control", "private, max-age=600");
    return res.status(200).send(photo.data);
  } catch (error) { return fail(res, 500, "Failed to load the photo."); }
}

// ---------------- disputes ----------------
/** POST /api/orders/:id/dispute { reason, description } */
async function openDispute(req, res) {
  try {
    const order = await orderParties(req.params.id);
    if (!order) return fail(res, 404, "Order not found.");
    if (!isParty(order, req.userId)) return fail(res, 403, "This is not your order.");
    if (["placed", "cancelled"].includes(order.status)) return fail(res, 409, "A problem can be raised after the order is accepted.");
    const { reason, description } = req.body || {};
    if (!["quality", "quantity", "not_delivered", "not_paid", "wrong_price", "other"].includes(reason)) return fail(res, 400, "Choose what went wrong.");
    if (await Dispute.exists({ order: order._id, status: "open" })) return fail(res, 409, "A problem is already open for this order.", "already_open");
    const isFarmer = String(order.farmer) === String(req.userId);
    const text = cleanText(description || "", 500);
    const dispute = await Dispute.create({ order: order._id, openedBy: req.userId, against: isFarmer ? order.buyer : order.farmer, reason, description: text, messages: text ? [{ by: req.userId, role: isFarmer ? "farmer" : "buyer", text: text.slice(0, 400) }] : [] });
    if (!isFarmer) await notifyFarmer(order.farmer, { type: "order_update", dedupeKey: `dispute-${dispute._id}`, title: "A buyer reported a problem", message: "Open Orders to see the problem and reply. The AgriLink team can help if you can't agree." });
    return res.status(201).json({ success: true, data: { id: String(dispute._id) } });
  } catch (error) { console.error("openDispute error:", error); return fail(res, 500, "Failed to open the problem."); }
}

function shapeDispute(d, uid) {
  return { id: String(d._id), orderId: String(d.order), reason: d.reason, description: d.description, status: d.status, resolution: d.resolution, openedByMe: String(d.openedBy) === String(uid), createdAt: d.createdAt, messages: d.messages.map((m) => ({ role: m.role, text: m.text, at: m.at, mine: String(m.by) === String(uid) })) };
}

async function myDisputes(req, res) {
  const list = await Dispute.find({ $or: [{ openedBy: req.userId }, { against: req.userId }] }).sort({ createdAt: -1 }).limit(30);
  return res.status(200).json({ success: true, data: list.map((d) => shapeDispute(d, req.userId)) });
}

async function disputeMessage(req, res) {
  try {
    if (!validId(req.params.id)) return fail(res, 400, "Invalid id.");
    const d = await Dispute.findById(req.params.id);
    if (!d) return fail(res, 404, "Not found.");
    const admin = req.userRole === "admin";
    const party = [String(d.openedBy), String(d.against)].includes(String(req.userId));
    if (!admin && !party) return fail(res, 403, "This is not your case.");
    if (d.status !== "open") return fail(res, 409, "This problem is already closed.");
    const text = cleanText((req.body || {}).text || "", 400);
    if (!text) return fail(res, 400, "Write a message.");
    d.messages.push({ by: req.userId, role: admin ? "admin" : String(d.against) === String(req.userId) ? "other side" : "opener", text });
    await d.save();
    return res.status(201).json({ success: true });
  } catch (error) { return fail(res, 500, "Failed."); }
}

async function adminDisputes(req, res) {
  const filter = req.query.status ? { status: req.query.status } : {};
  const list = await Dispute.find(filter).sort({ createdAt: -1 }).limit(100).populate("openedBy", "fullName role phone").populate("against", "fullName role phone").populate("order", "cropType quantityKg totalLkr status");
  return res.status(200).json({ success: true, data: list.map((d) => ({ ...shapeDispute(d, req.userId), openedBy: d.openedBy, against: d.against, order: d.order, photoCount: 0 })) });
}

/** POST /api/admin/disputes/:id/resolve { outcome: "resolved"|"dismissed", resolution } */
async function resolveDispute(req, res) {
  try {
    if (!validId(req.params.id)) return fail(res, 400, "Invalid id.");
    const { outcome, resolution } = req.body || {};
    if (!["resolved", "dismissed"].includes(outcome)) return fail(res, 400, "Choose resolved or dismissed.");
    const d = await Dispute.findById(req.params.id);
    if (!d) return fail(res, 404, "Not found.");
    if (d.status !== "open") return fail(res, 409, "Already closed.");
    d.status = outcome; d.resolution = cleanText(resolution || "", 500); d.resolvedBy = req.userId; d.resolvedAt = new Date(); await d.save();
    const order = await TradeOrder.findById(d.order).select("farmer");
    if (order) await notifyFarmer(order.farmer, { type: "order_update", dedupeKey: `dispute-closed-${d._id}`, title: "A problem was closed", message: d.resolution || `The AgriLink team marked it ${outcome}.` });
    return res.status(200).json({ success: true });
  } catch (error) { return fail(res, 500, "Failed."); }
}

// ---------------- reports & blocks ----------------
async function reportUser(req, res) {
  try {
    const { reportedId, context, contextId, reason, note } = req.body || {};
    if (!validId(reportedId)) return fail(res, 400, "Choose who to report.");
    if (String(reportedId) === String(req.userId)) return fail(res, 400, "You can't report yourself.");
    if (!["scam", "abuse", "fake_listing", "no_show", "unsafe", "other"].includes(reason)) return fail(res, 400, "Choose a reason.");
    if (!(await User.exists({ _id: reportedId }))) return fail(res, 404, "Person not found.");
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    if (await UserReport.exists({ reporter: req.userId, reported: reportedId, reason, createdAt: { $gte: since } })) return fail(res, 409, "You already reported this today.", "duplicate");
    if ((await UserReport.countDocuments({ reporter: req.userId, createdAt: { $gte: since } })) >= 10) return fail(res, 429, "Too many reports today.", "rate_limited");
    await UserReport.create({ reporter: req.userId, reported: reportedId, context: ["order", "trip", "listing"].includes(context) ? context : "other", contextId: String(contextId || "").slice(0, 40), reason, note: cleanText(note || "", 300) });
    return res.status(201).json({ success: true, message: "Thank you. The AgriLink team will look at this." });
  } catch (error) { console.error("reportUser error:", error); return fail(res, 500, "Failed to send the report."); }
}

async function adminReports(req, res) {
  const filter = req.query.status ? { status: req.query.status } : {};
  const list = await UserReport.find(filter).sort({ createdAt: -1 }).limit(100).populate("reporter", "fullName role").populate("reported", "fullName role phone isActive");
  const counts = {};
  for (const r of list) { const id = String(r.reported && r.reported._id); counts[id] = (counts[id] || 0) + 1; }
  return res.status(200).json({ success: true, data: list.map((r) => ({ id: String(r._id), reporter: r.reporter, reported: r.reported, reportsAgainstThisPerson: counts[String(r.reported && r.reported._id)], context: r.context, reason: r.reason, note: r.note, status: r.status, createdAt: r.createdAt })) });
}

async function setReportStatus(req, res) {
  if (!validId(req.params.id) || !["open", "reviewed", "actioned"].includes((req.body || {}).status)) return fail(res, 400, "Invalid request.");
  await UserReport.updateOne({ _id: req.params.id }, { $set: { status: req.body.status } });
  return res.status(200).json({ success: true });
}

async function blockUser(req, res) {
  const id = (req.body || {}).userId;
  if (!validId(id) || String(id) === String(req.userId)) return fail(res, 400, "Choose someone else to block.");
  await Block.updateOne({ blocker: req.userId, blocked: id }, { $set: { blocker: req.userId, blocked: id } }, { upsert: true });
  return res.status(200).json({ success: true });
}
async function unblockUser(req, res) {
  if (!validId(req.params.userId)) return fail(res, 400, "Invalid person.");
  await Block.deleteOne({ blocker: req.userId, blocked: req.params.userId });
  return res.status(200).json({ success: true });
}
async function myBlocks(req, res) {
  const blocks = await Block.find({ blocker: req.userId }).populate("blocked", "fullName role").lean();
  return res.status(200).json({ success: true, data: blocks.filter((b) => b.blocked).map((b) => ({ userId: String(b.blocked._id), name: b.blocked.fullName, role: b.blocked.role })) });
}

// ---------------- feedback ----------------
async function sendFeedback(req, res) {
  try {
    const { kind, message, screen, appVersion, clientId } = req.body || {};
    const text = cleanText(message || "", 600);
    if (text.length < 3) return fail(res, 400, "Please write a few words.");
    if (clientId && (await Feedback.exists({ user: req.userId, clientId }))) return res.status(200).json({ success: true, duplicate: true });
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    if ((await Feedback.countDocuments({ user: req.userId, createdAt: { $gte: since } })) >= 10) return fail(res, 429, "Thank you — that's enough feedback for today.", "rate_limited");
    await Feedback.create({ user: req.userId, kind: ["bug", "idea", "praise", "help"].includes(kind) ? kind : "idea", message: text, screen: String(screen || "").slice(0, 60), appVersion: String(appVersion || "").slice(0, 20), clientId: String(clientId || "").slice(0, 40) });
    return res.status(201).json({ success: true, message: "Thank you! We read every message." });
  } catch (error) { return fail(res, 500, "Failed to send."); }
}
async function adminFeedback(req, res) {
  const filter = req.query.status ? { status: req.query.status } : {};
  const list = await Feedback.find(filter).sort({ createdAt: -1 }).limit(150).populate("user", "fullName role farmerProfile.district");
  return res.status(200).json({ success: true, data: list.map((f) => ({ id: String(f._id), kind: f.kind, message: f.message, screen: f.screen, appVersion: f.appVersion, status: f.status, createdAt: f.createdAt, user: f.user ? { name: f.user.fullName, role: f.user.role, district: f.user.farmerProfile && f.user.farmerProfile.district } : null })) });
}
async function setFeedbackStatus(req, res) {
  if (!validId(req.params.id) || !["new", "seen", "done"].includes((req.body || {}).status)) return fail(res, 400, "Invalid request.");
  await Feedback.updateOne({ _id: req.params.id }, { $set: { status: req.body.status } });
  return res.status(200).json({ success: true });
}

// ---------------- ID / business verification ----------------
/** POST /api/auth/verification { docType, imageBase64 } — the photo is seen only by admins and deleted once they decide. */
async function submitVerification(req, res) {
  try {
    const { docType, imageBase64 } = req.body || {};
    if (!["nic", "business_reg", "farmer_card"].includes(docType)) return fail(res, 400, "Choose the document type.");
    const img = decodeImage(imageBase64);
    if (img.error) return fail(res, img.status || 400, img.error);
    const user = await User.findById(req.userId).select("verification");
    if (user.verification && user.verification.status === "verified") return fail(res, 409, "You are already verified.", "already_verified");
    await Photo.deleteMany({ owner: req.userId, purpose: "verification" });
    await Photo.create({ owner: req.userId, purpose: "verification", label: docType, mime: img.mime, data: img.bytes, size: img.bytes.length });
    await User.updateOne({ _id: req.userId }, { $set: { "verification.status": "pending", "verification.docType": docType, "verification.submittedAt": new Date(), "verification.note": "" } });
    return res.status(201).json({ success: true, message: "Sent. The AgriLink team will check it soon." });
  } catch (error) { console.error("submitVerification error:", error); return fail(res, 500, "Failed to send the document."); }
}

async function adminVerifications(req, res) {
  const status = req.query.status || "pending";
  const users = await User.find({ "verification.status": status }).select("fullName role phone verification farmerProfile.district buyerProfile.companyName").sort({ "verification.submittedAt": 1 }).limit(100).lean();
  const photos = await Photo.find({ purpose: "verification", owner: { $in: users.map((u) => u._id) } }).select("owner").lean();
  const photoOf = new Map(photos.map((p) => [String(p.owner), String(p._id)]));
  return res.status(200).json({ success: true, data: users.map((u) => ({ userId: String(u._id), name: u.fullName, role: u.role, phone: u.phone, district: u.farmerProfile && u.farmerProfile.district, company: u.buyerProfile && u.buyerProfile.companyName, docType: u.verification.docType, submittedAt: u.verification.submittedAt, photoId: photoOf.get(String(u._id)) || null })) });
}

/** POST /api/admin/verifications/:userId { decision: "verified"|"rejected", note } */
async function decideVerification(req, res) {
  try {
    if (!validId(req.params.userId)) return fail(res, 400, "Invalid person.");
    const { decision, note } = req.body || {};
    if (!["verified", "rejected"].includes(decision)) return fail(res, 400, "Choose verified or rejected.");
    const user = await User.findById(req.params.userId).select("verification role");
    if (!user || !user.verification || user.verification.status !== "pending") return fail(res, 409, "There is nothing pending for this person.");
    const set = { "verification.status": decision, "verification.decidedAt": new Date(), "verification.note": cleanText(note || "", 200) };
    if (decision === "verified" && user.role === "buyer") set["buyerProfile.verifiedBusiness"] = true;
    await User.updateOne({ _id: user._id }, { $set: set });
    await Photo.deleteMany({ owner: user._id, purpose: "verification" }); // the document is not kept
    if (user.role === "farmer") await notifyFarmer(user._id, { type: "order_update", dedupeKey: `verify-${user._id}-${decision}-${Date.now()}`, title: decision === "verified" ? "You are verified ✓" : "Verification not accepted", message: decision === "verified" ? "Buyers now see a Verified badge on your listings." : (set["verification.note"] || "Please send a clearer photo of your document.") });
    return res.status(200).json({ success: true });
  } catch (error) { console.error("decideVerification error:", error); return fail(res, 500, "Failed."); }
}

// ---------------- how I want to be paid ----------------
async function getPayment(req, res) {
  const p = await PaymentProfile.findOne({ user: req.userId }).lean();
  const qr = await Photo.findOne({ owner: req.userId, purpose: "payment_qr" }).select("_id").lean();
  return res.status(200).json({ success: true, data: { instructions: (p && p.instructions) || "", hasQr: Boolean(qr), qrPhotoId: qr ? String(qr._id) : null } });
}
async function setPayment(req, res) {
  const text = cleanText((req.body || {}).instructions || "", 200);
  await PaymentProfile.updateOne({ user: req.userId }, { $set: { user: req.userId, instructions: text } }, { upsert: true });
  return res.status(200).json({ success: true });
}
async function setPaymentQr(req, res) {
  const img = decodeImage((req.body || {}).imageBase64);
  if (img.error) return fail(res, img.status || 400, img.error);
  await Photo.deleteMany({ owner: req.userId, purpose: "payment_qr" });
  const photo = await Photo.create({ owner: req.userId, purpose: "payment_qr", mime: img.mime, data: img.bytes, size: img.bytes.length });
  await PaymentProfile.updateOne({ user: req.userId }, { $set: { user: req.userId, hasQr: true } }, { upsert: true });
  return res.status(200).json({ success: true, qrPhotoId: String(photo._id) });
}
async function removePaymentQr(req, res) {
  await Photo.deleteMany({ owner: req.userId, purpose: "payment_qr" });
  await PaymentProfile.updateOne({ user: req.userId }, { $set: { hasQr: false } });
  return res.status(200).json({ success: true });
}

module.exports = { decodeImage, blockedEither, addOrderPhoto, listOrderPhotos, viewPhoto, openDispute, myDisputes, disputeMessage, adminDisputes, resolveDispute, reportUser, adminReports, setReportStatus, blockUser, unblockUser, myBlocks, sendFeedback, adminFeedback, setFeedbackStatus, submitVerification, adminVerifications, decideVerification, getPayment, setPayment, setPaymentQr, removePaymentQr };
