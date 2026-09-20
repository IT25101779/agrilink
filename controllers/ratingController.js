const mongoose = require("mongoose");
const Rating = require("../models/Rating");
const TradeOrder = require("../models/TradeOrder");
const { computeTrust } = require("../utils/trust");
const { checkContent, cleanText } = require("../utils/chatConfig");

const TAGS = ["on_time", "good_quality", "fair_price", "honest_weight", "easy_to_deal_with", "paid_promptly", "late", "poor_quality", "hard_to_reach"];

function fail(res, status, message, code) {
  return res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
}

/** POST /api/ratings { orderId, stars, tags?, comment? } — rate the other side of a delivered order. */
async function rate(req, res) {
  try {
    const { orderId, stars, tags, comment } = req.body || {};
    if (!mongoose.isValidObjectId(String(orderId))) return fail(res, 400, "Invalid order.");
    const value = Number(stars);
    if (!Number.isInteger(value) || value < 1 || value > 5) return fail(res, 400, "Stars must be 1 to 5.");
    const order = await TradeOrder.findById(orderId);
    if (!order) return fail(res, 404, "Order not found.");
    const isFarmer = String(order.farmer) === String(req.userId);
    const isBuyer = String(order.buyer) === String(req.userId);
    if (!isFarmer && !isBuyer) return fail(res, 403, "This is not your order.");
    if (!["delivered", "paid"].includes(order.status)) return fail(res, 409, "You can rate after delivery.");
    const text = cleanText(comment || "", 200);
    const content = checkContent(text);
    if (!content.ok) return fail(res, 400, "Please keep the comment respectful and free of phone numbers or links.", content.code);
    try {
      await Rating.create({ order: order._id, rater: req.userId, ratee: isFarmer ? order.buyer : order.farmer, stars: value, tags: (Array.isArray(tags) ? tags : []).filter((t) => TAGS.includes(t)).slice(0, 4), comment: text });
    } catch (error) {
      if (error.code === 11000) return fail(res, 409, "You already rated this order.", "already_rated");
      throw error;
    }
    return res.status(201).json({ success: true });
  } catch (error) {
    console.error("rate error:", error);
    return fail(res, 500, "Failed to save the rating.");
  }
}

/** POST /api/ratings/trust { ids: [...] } — badges and averages for up to 50 people. */
async function trustBatch(req, res) {
  try {
    const ids = (Array.isArray((req.body || {}).ids) ? req.body.ids : []).filter((id) => mongoose.isValidObjectId(String(id))).slice(0, 50);
    return res.status(200).json({ success: true, data: ids.length ? await computeTrust(ids) : {} });
  } catch (error) {
    console.error("trustBatch error:", error);
    return fail(res, 500, "Failed to load trust scores.");
  }
}

/** GET /api/ratings/received — what people said about ME (comments, newest first). */
async function received(req, res) {
  try {
    const list = await Rating.find({ ratee: req.userId }).sort({ createdAt: -1 }).limit(30).select("stars tags comment createdAt").lean();
    const trust = (await computeTrust([req.userId]))[String(req.userId)];
    return res.status(200).json({ success: true, trust, data: list });
  } catch (error) {
    console.error("received error:", error);
    return fail(res, 500, "Failed to load ratings.");
  }
}

module.exports = { rate, trustBatch, received, TAGS };
