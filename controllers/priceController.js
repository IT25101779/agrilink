const mongoose = require("mongoose");
const MarketPrice = require("../models/MarketPrice");
const PriceAlert = require("../models/PriceAlert");
const CultivationTimeline = require("../models/CultivationTimeline");
const MarketplaceListing = require("../models/MarketplaceListing");
const { canonicalCrop } = require("../utils/chatConfig");
const { notifyFarmer } = require("../utils/notify");

const MARKETS = ["Dambulla", "Manning", "Pettah", "Kandy", "Jaffna", "Meegoda"];
const SHOCK_PERCENT = 15;
const MAX_ALERTS = 10;
const MAX_REPORTS_PER_DAY = 10;

function fail(res, status, message, code) {
  return res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
}

const today = () => new Date().toISOString().slice(0, 10);
const daysAgoKey = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** GET /api/prices/board?market= — the latest official price per crop and market, with the change since the previous day. */
async function board(req, res) {
  try {
    const filter = { verified: true, day: { $gte: daysAgoKey(14) } };
    if (req.query.market && MARKETS.includes(req.query.market)) filter.market = req.query.market;
    const rows = await MarketPrice.find(filter).sort({ day: -1 }).lean();
    const groups = new Map();
    for (const r of rows) {
      const key = `${r.cropType}|${r.market}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const community = await MarketPrice.find({ verified: false, day: { $gte: daysAgoKey(2) } }).lean();
    const data = [];
    for (const [key, list] of groups) {
      const latest = list[0], previous = list.find((r) => r.day < latest.day);
      const reports = community.filter((c) => c.cropType === latest.cropType && c.market === latest.market).map((c) => c.pricePerKg);
      data.push({
        cropType: latest.cropType, market: latest.market, pricePerKg: latest.pricePerKg, day: latest.day,
        previousPricePerKg: previous ? previous.pricePerKg : null,
        changePercent: previous ? Math.round(((latest.pricePerKg - previous.pricePerKg) / previous.pricePerKg) * 1000) / 10 : null,
        communityMedian: reports.length >= 2 ? median(reports) : null, communityReports: reports.length,
      });
    }
    data.sort((a, b) => a.cropType.localeCompare(b.cropType) || a.market.localeCompare(b.market));
    return res.status(200).json({ success: true, markets: MARKETS, data });
  } catch (error) {
    console.error("board error:", error);
    return fail(res, 500, "Failed to load the price board.");
  }
}

/** GET /api/prices/history/:crop?market=&days= */
async function history(req, res) {
  try {
    const crop = canonicalCrop(req.params.crop);
    if (!crop) return fail(res, 400, "Unknown crop.");
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 3), 90);
    const filter = { cropType: crop, verified: true, day: { $gte: daysAgoKey(days) } };
    if (req.query.market && MARKETS.includes(req.query.market)) filter.market = req.query.market;
    const rows = await MarketPrice.find(filter).sort({ day: 1 }).lean();
    const byDay = {};
    rows.forEach((r) => { (byDay[r.day] = byDay[r.day] || []).push(r.pricePerKg); });
    const data = Object.entries(byDay).map(([day, list]) => ({ day, pricePerKg: Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 }));
    return res.status(200).json({ success: true, cropType: crop, data });
  } catch (error) {
    console.error("history error:", error);
    return fail(res, 500, "Failed to load the history.");
  }
}

/** POST /api/prices/report { cropType, market, pricePerKg } — a farmer tells what they saw at market today (unverified). */
async function report(req, res) {
  try {
    const b = req.body || {};
    const crop = canonicalCrop(b.cropType);
    if (!crop) return fail(res, 400, "Unknown crop.");
    if (!MARKETS.includes(b.market)) return fail(res, 400, "Unknown market.");
    const price = Number(b.pricePerKg);
    if (!Number.isFinite(price) || price < 1 || price > 5000) return fail(res, 400, "Enter a price between 1 and 5,000.");
    const already = await MarketPrice.countDocuments({ reporter: req.userId, day: today() });
    if (already >= MAX_REPORTS_PER_DAY) return fail(res, 429, "You've reported enough for today. Thank you!", "rate_limited");
    // A wild guess next to the official price is ignored, so nobody can spoil the board.
    const official = await MarketPrice.findOne({ cropType: crop, market: b.market, verified: true }).sort({ day: -1 }).lean();
    if (official && (price > official.pricePerKg * 3 || price < official.pricePerKg / 3)) return fail(res, 400, "That price looks far from today's market price. Please check it.", "implausible");
    await MarketPrice.create({ cropType: crop, market: b.market, pricePerKg: price, day: today(), source: "farmer", verified: false, reporter: req.userId });
    return res.status(201).json({ success: true, message: "Thanks! Your report helps other farmers." });
  } catch (error) {
    console.error("report error:", error);
    return fail(res, 500, "Failed to save the report.");
  }
}

// ---------------- alerts ----------------

async function createAlert(req, res) {
  try {
    const b = req.body || {};
    const crop = canonicalCrop(b.cropType);
    if (!crop) return fail(res, 400, "Unknown crop.");
    if (!["above", "below"].includes(b.direction)) return fail(res, 400, "Choose above or below.");
    const threshold = Number(b.thresholdLkr);
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 10000) return fail(res, 400, "Enter a price between 1 and 10,000.");
    if (b.market && !MARKETS.includes(b.market)) return fail(res, 400, "Unknown market.");
    if ((await PriceAlert.countDocuments({ farmer: req.userId })) >= MAX_ALERTS) return fail(res, 409, `You can keep up to ${MAX_ALERTS} alerts.`, "limit");
    const alert = await PriceAlert.create({ farmer: req.userId, cropType: crop, direction: b.direction, thresholdLkr: threshold, market: b.market || "" });
    return res.status(201).json({ success: true, data: alert });
  } catch (error) {
    console.error("createAlert error:", error);
    return fail(res, 500, "Failed to save the alert.");
  }
}

async function myAlerts(req, res) {
  try {
    return res.status(200).json({ success: true, data: await PriceAlert.find({ farmer: req.userId }).sort({ createdAt: -1 }) });
  } catch (error) {
    return fail(res, 500, "Failed to load alerts.");
  }
}

async function deleteAlert(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 400, "Invalid alert.");
    await PriceAlert.deleteOne({ _id: req.params.id, farmer: req.userId });
    return res.status(200).json({ success: true });
  } catch (error) {
    return fail(res, 500, "Failed to delete the alert.");
  }
}

// ---------------- admin ----------------

/**
 * POST /api/admin/prices { market, day?, prices: [{ cropType, pricePerKg }] }
 * Saves the official prices, then tells the farmers who care: anyone whose
 * price alert was hit, and anyone growing or selling a crop that moved 15%+.
 */
async function publishPrices(req, res) {
  try {
    const b = req.body || {};
    if (!MARKETS.includes(b.market)) return fail(res, 400, "Choose a market.");
    const day = b.day && /^\d{4}-\d{2}-\d{2}$/.test(b.day) ? b.day : today();
    if (!Array.isArray(b.prices) || b.prices.length === 0 || b.prices.length > 60) return fail(res, 400, "Send 1–60 prices.");

    const saved = [];
    for (const item of b.prices) {
      const crop = canonicalCrop(item && item.cropType);
      const price = Number(item && item.pricePerKg);
      if (!crop || !Number.isFinite(price) || price < 0.5 || price > 10000) return fail(res, 400, `Invalid price for ${item && item.cropType}.`);
      const previous = await MarketPrice.findOne({ cropType: crop, market: b.market, verified: true, day: { $lt: day } }).sort({ day: -1 }).lean();
      await MarketPrice.deleteMany({ cropType: crop, market: b.market, verified: true, day });
      await MarketPrice.create({ cropType: crop, market: b.market, pricePerKg: price, day, source: "admin", verified: true, reporter: req.userId });
      saved.push({ cropType: crop, price, previous: previous ? previous.pricePerKg : null });
    }

    let alertsTriggered = 0, shockReminders = 0;
    for (const s of saved) {
      const alerts = await PriceAlert.find({ cropType: s.cropType, $or: [{ market: "" }, { market: b.market }] });
      for (const a of alerts) {
        const hit = a.direction === "above" ? s.price >= a.thresholdLkr : s.price <= a.thresholdLkr;
        if (!hit || a.lastTriggeredDay === day) continue;
        await PriceAlert.updateOne({ _id: a._id }, { $set: { lastTriggeredDay: day } });
        const sent = await notifyFarmer(a.farmer, { type: "price_alert", cropType: s.cropType, dedupeKey: `alert-${a._id}-${day}`, title: `${s.cropType} price alert`, message: `${s.cropType} is LKR ${s.price}/kg at ${b.market} — ${a.direction === "above" ? "above" : "below"} your LKR ${a.thresholdLkr} alert.` });
        if (sent) alertsTriggered++;
      }
      if (s.previous) {
        const change = ((s.price - s.previous) / s.previous) * 100;
        if (Math.abs(change) >= SHOCK_PERCENT) {
          const growers = (await CultivationTimeline.find({ cropType: s.cropType, status: "active" }).select("farmer").lean()).map((t) => String(t.farmer));
          const sellers = (await MarketplaceListing.find({ cropType: s.cropType, status: "listed" }).select("farmer").lean()).map((l) => String(l.farmer));
          for (const farmerId of new Set([...growers, ...sellers])) {
            const sent = await notifyFarmer(farmerId, { type: "price_alert", cropType: s.cropType, dedupeKey: `shock-${s.cropType}-${b.market}-${day}`, title: `${s.cropType} price ${change > 0 ? "jumped" : "dropped"} ${Math.abs(Math.round(change))}%`, message: `${b.market} now pays LKR ${s.price}/kg (was ${s.previous}). ${change > 0 ? "A good time to sell." : "Think about holding or a group sale."}` });
            if (sent) shockReminders++;
          }
        }
      }
    }
    return res.status(201).json({ success: true, saved: saved.length, alertsTriggered, shockReminders });
  } catch (error) {
    console.error("publishPrices error:", error);
    return fail(res, 500, "Failed to publish prices.");
  }
}

module.exports = { board, history, report, createAlert, myAlerts, deleteAlert, publishPrices, MARKETS };
