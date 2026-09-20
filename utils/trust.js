const Rating = require("../models/Rating");
const TradeOrder = require("../models/TradeOrder");
const User = require("../models/User");

function badgeFor(completedOrders, average, ratingCount) {
  if (completedOrders >= 15 && ratingCount >= 5 && average >= 4.6) return "top";
  if (completedOrders >= 5 && ratingCount >= 3 && average >= 4.2) return "trusted";
  if (completedOrders >= 1) return "rising";
  return "new";
}

/** Trust summary for several users at once: { [userId]: { average, ratingCount, completedOrders, badge } } */
async function computeTrust(userIds) {
  const ids = [...new Set(userIds.map(String))];
  const [ratings, orders, verifiedUsers] = await Promise.all([
    Rating.find({ ratee: { $in: ids } }).select("ratee stars").lean(),
    TradeOrder.find({ status: "paid", $or: [{ farmer: { $in: ids } }, { buyer: { $in: ids } }] }).select("farmer buyer").lean(),
    User.find({ _id: { $in: ids }, "verification.status": "verified" }).select("_id").lean(),
  ]);
  const verified = new Set(verifiedUsers.map((u) => String(u._id)));
  const result = {};
  for (const id of ids) result[id] = { sum: 0, ratingCount: 0, completedOrders: 0 };
  ratings.forEach((r) => { const t = result[String(r.ratee)]; if (t) { t.sum += r.stars; t.ratingCount += 1; } });
  orders.forEach((o) => { [String(o.farmer), String(o.buyer)].forEach((id) => { if (result[id]) result[id].completedOrders += 1; }); });
  const out = {};
  for (const id of ids) {
    const t = result[id];
    const average = t.ratingCount ? Math.round((t.sum / t.ratingCount) * 10) / 10 : 0;
    out[id] = { average, ratingCount: t.ratingCount, completedOrders: t.completedOrders, badge: badgeFor(t.completedOrders, average, t.ratingCount), verified: verified.has(id) };
  }
  return out;
}

module.exports = { computeTrust, badgeFor };
