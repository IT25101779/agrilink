const CultivationTimeline = require("../models/CultivationTimeline");
const MarketplaceListing = require("../models/MarketplaceListing");
const DemandRequest = require("../models/DemandRequest");
const Reminder = require("../models/Reminder");
const User = require("../models/User");
const { buildForecast } = require("../utils/priceForecast");
const { adviseListing, sortByUrgency } = require("../utils/sellOrHold");
const { planProfit } = require("../utils/cropEconomics");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---- Oversupply Guard tuning ----
const MIN_PLANTINGS_FOR_SIGNAL = 5; // below this the district has too little data to judge
const HIGH_SHARE = 0.3; // 30%+ of the district's active crops are the same crop...
const HIGH_MIN_FARMERS = 4; // ...and at least this many different farmers
const MEDIUM_SHARE = 0.18;
const MEDIUM_MIN_FARMERS = 3;

// ---- Sell-or-Hold tuning ----
const TREND_RECENT_DAYS = 14;
const TREND_PRIOR_DAYS = 45;

function round1(n) {
  return Math.round(n * 10) / 10;
}

function classifySaturation({ farmers, sharePercent }) {
  const share = sharePercent / 100;
  if (share >= HIGH_SHARE && farmers >= HIGH_MIN_FARMERS) return "high";
  if (share >= MEDIUM_SHARE && farmers >= MEDIUM_MIN_FARMERS) return "medium";
  return "low";
}

/**
 * OVERSUPPLY GUARD core: how many farmers in a district are CURRENTLY
 * growing each crop. Only anonymous counts leave the server — never names.
 * (Timelines reach the server through the app's normal offline sync.)
 */
async function computeDistrictSignals(district) {
  const now = new Date();

  // 1) Which farmers live in this district?  2) What are their active crops?
  // Two simple queries and grouping in code — no database-side joins, so it
  // behaves the same on every MongoDB version.
  const farmers = await User.find({ role: "farmer", "farmerProfile.district": district }).select("_id").lean();
  const farmerIds = farmers.map((f) => f._id);

  const timelines = farmerIds.length
    ? await CultivationTimeline.find({ farmer: { $in: farmerIds }, status: "active", expectedHarvestDate: { $gte: now } })
        .select("farmer cropType landSizeAcres")
        .lean()
    : [];

  const byCrop = new Map();
  for (const t of timelines) {
    const key = t.cropType;
    if (!byCrop.has(key)) byCrop.set(key, { farmerIds: new Set(), acres: 0, plantings: 0 });
    const entry = byCrop.get(key);
    entry.farmerIds.add(String(t.farmer));
    entry.acres += Number(t.landSizeAcres) || 0;
    entry.plantings += 1;
  }

  const totalPlantings = timelines.length;
  const allFarmers = new Set(timelines.map((t) => String(t.farmer)));
  const enoughData = totalPlantings >= MIN_PLANTINGS_FOR_SIGNAL;

  const crops = [...byCrop.entries()]
    .map(([cropType, entry]) => {
      const farmerCount = entry.farmerIds.size;
      const sharePercent = totalPlantings > 0 ? round1((entry.plantings / totalPlantings) * 100) : 0;
      return {
        cropType,
        farmers: farmerCount,
        plantings: entry.plantings,
        acres: round1(entry.acres),
        sharePercent,
        // With too little data in a district we refuse to raise an alarm.
        level: enoughData ? classifySaturation({ farmers: farmerCount, sharePercent }) : "low",
      };
    })
    .sort((x, y) => y.farmers - x.farmers);

  return { district, enoughData, totalPlantings, totalFarmers: allFarmers.size, crops };
}

async function getOpenDemandSummary(district) {
  const now = new Date();
  const filter = { status: "open", neededBy: { $gte: now } };
  if (district) filter.$or = [{ district }, { district: "" }];

  const requests = await DemandRequest.find(filter).select("cropType quantityKg fulfilledKg maxPricePerKg").lean();

  const byCrop = new Map();
  for (const r of requests) {
    if (!byCrop.has(r.cropType)) byCrop.set(r.cropType, { requests: 0, totalKg: 0, topPricePerKg: 0 });
    const entry = byCrop.get(r.cropType);
    entry.requests += 1;
    entry.totalKg += Math.max(0, r.quantityKg - (r.fulfilledKg || 0));
    entry.topPricePerKg = Math.max(entry.topPricePerKg, r.maxPricePerKg);
  }

  return [...byCrop.entries()]
    .map(([cropType, e]) => ({ cropType, requests: e.requests, totalKg: e.totalKg, topPricePerKg: e.topPricePerKg }))
    .sort((x, y) => y.totalKg - x.totalKg);
}

async function getFarmerDistrict(userId) {
  const user = await User.findById(userId).select("farmerProfile.district");
  return user && user.farmerProfile ? user.farmerProfile.district || "" : "";
}

/**
 * Compares completed-sale prices of the last 14 days with the 15-45 days
 * before that. Returns null when there isn't a sale in BOTH windows.
 */
async function getPriceTrend(cropType) {
  const now = Date.now();
  const recentStart = now - TREND_RECENT_DAYS * MS_PER_DAY;
  const priorStart = new Date(now - TREND_PRIOR_DAYS * MS_PER_DAY);

  const sold = await MarketplaceListing.find({ cropType, status: "sold", tier: "primary", updatedAt: { $gte: priorStart } })
    .select("currentPricePerKg updatedAt")
    .lean();

  const recent = sold.filter((l) => new Date(l.updatedAt).getTime() >= recentStart);
  const prior = sold.filter((l) => new Date(l.updatedAt).getTime() < recentStart);
  if (recent.length === 0 || prior.length === 0) return null;

  const avg = (rows) => rows.reduce((sum, l) => sum + l.currentPricePerKg, 0) / rows.length;
  const priorAvg = avg(prior);
  if (!priorAvg) return null;

  return { percent: round1(((avg(recent) - priorAvg) / priorAvg) * 100), samples: sold.length };
}

/**
 * GET /api/insights/planting-signals?district=Kandy
 * OVERSUPPLY GUARD + demand signals for the Crop Navigator.
 */
async function getPlantingSignals(req, res) {
  try {
    let district = typeof req.query.district === "string" ? req.query.district.trim() : "";
    if (!district) district = await getFarmerDistrict(req.userId);

    if (!district) {
      return res.status(200).json({
        success: true,
        data: { district: "", enoughData: false, totalPlantings: 0, totalFarmers: 0, crops: [], demand: await getOpenDemandSummary("") },
      });
    }

    const [signals, demand] = await Promise.all([computeDistrictSignals(district), getOpenDemandSummary(district)]);
    return res.status(200).json({ success: true, data: { ...signals, demand } });
  } catch (error) {
    console.error("getPlantingSignals error:", error);
    return res.status(500).json({ success: false, message: "Failed to load planting signals." });
  }
}

/**
 * GET /api/insights/price-forecast/:cropType?weeks=12
 */
async function getPriceForecast(req, res) {
  try {
    const cropType = String(req.params.cropType || "").trim();
    if (!cropType) {
      return res.status(400).json({ success: false, message: "cropType is required." });
    }
    let weeks = parseInt(req.query.weeks, 10);
    if (!Number.isFinite(weeks)) weeks = 12;
    weeks = Math.min(Math.max(weeks, 4), 16);

    const forecast = await buildForecast(cropType, { weeks });
    return res.status(200).json({ success: true, data: forecast });
  } catch (error) {
    console.error("getPriceForecast error:", error);
    return res.status(500).json({ success: false, message: "Failed to build price forecast." });
  }
}

/**
 * Shared by the advice endpoint and the alert generator: advice for every
 * listing this farmer currently has on sale.
 */
async function buildAdviceForFarmer(farmerId) {
  const listings = await MarketplaceListing.find({ farmer: farmerId, status: "listed" }).lean();
  if (listings.length === 0) return [];

  const district = await getFarmerDistrict(farmerId);
  const signals = district ? await computeDistrictSignals(district) : { crops: [], enoughData: false };

  const cropNames = [...new Set(listings.map((l) => l.cropType))];
  const perCrop = {};
  await Promise.all(
    cropNames.map(async (cropType) => {
      const [forecast, trend] = await Promise.all([buildForecast(cropType, { weeks: 4 }), getPriceTrend(cropType)]);
      const match = signals.crops.find((c) => String(c.cropType).toLowerCase() === String(cropType).toLowerCase());
      perCrop[cropType] = { forecast, trend, saturationLevel: match ? match.level : signals.enoughData ? "low" : "unknown" };
    })
  );

  const now = new Date();
  const advice = listings.map((listing) => {
    const ctx = perCrop[listing.cropType];
    return adviseListing({ listing, forecast: ctx.forecast, trend: ctx.trend, saturationLevel: ctx.saturationLevel, now });
  });
  return sortByUrgency(advice);
}

/**
 * GET /api/insights/sell-or-hold
 * Advice for every listing of the logged-in farmer, most urgent first.
 */
async function getSellOrHold(req, res) {
  try {
    const advice = await buildAdviceForFarmer(req.userId);
    return res.status(200).json({ success: true, count: advice.length, data: advice });
  } catch (error) {
    console.error("getSellOrHold error:", error);
    return res.status(500).json({ success: false, message: "Failed to build sell-or-hold advice." });
  }
}

/**
 * GET /api/insights/profit-plan/:cropType?acres=1&yieldKgPerAcre=&costPerAcre=&pricePerKg=
 * PROFIT PLANNER: estimated cost, harvest and profit range for one crop.
 * Any of the last three parameters overrides the typical planning figure.
 */
async function getProfitPlan(req, res) {
  try {
    const cropType = String(req.params.cropType || "").trim();
    if (!cropType) return res.status(400).json({ success: false, message: "cropType is required." });

    const acres = req.query.acres === undefined ? 1 : Number(req.query.acres);
    if (!Number.isFinite(acres) || acres < 0.1 || acres > 100) {
      return res.status(400).json({ success: false, message: "acres must be between 0.1 and 100." });
    }

    const overrides = {};
    for (const key of ["yieldKgPerAcre", "costPerAcre", "pricePerKg"]) {
      if (req.query[key] === undefined || req.query[key] === "") continue;
      const value = Number(req.query[key]);
      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ success: false, message: `${key} must be a positive number.` });
      }
      overrides[key] = value;
    }

    const district = await getFarmerDistrict(req.userId);
    const [forecast, signals] = await Promise.all([
      buildForecast(cropType, { weeks: 16 }),
      district ? computeDistrictSignals(district) : Promise.resolve({ crops: [], enoughData: false }),
    ]);
    const match = signals.crops.find((c) => String(c.cropType).toLowerCase() === cropType.toLowerCase());
    const saturationLevel = match ? match.level : signals.enoughData ? "low" : "unknown";

    const plan = planProfit({ cropType, acres, overrides, forecast, saturationLevel });
    return res.status(200).json({ success: true, data: { ...plan, district, saturationLevel } });
  } catch (error) {
    console.error("getProfitPlan error:", error);
    return res.status(500).json({ success: false, message: "Failed to build the profit plan." });
  }
}

const ALERT_TITLES = {
  sell_now: (crop) => `Sell soon: ${crop}`,
  hold: (crop) => `Hold: ${crop}`,
  reprice_up: (crop) => `Price check: ${crop}`,
  reprice_down: (crop) => `Price check: ${crop}`,
};

/**
 * POST /api/insights/price-alerts/generate
 * Turns today's advice into entries in the farmer's Reminders (the bell
 * icon). Safe to call as often as you like — one alert per listing, per
 * action, per day (a duplicate is silently skipped).
 */
async function generatePriceAlerts(req, res) {
  try {
    const advice = await buildAdviceForFarmer(req.userId);
    const today = new Date().toISOString().slice(0, 10);
    let created = 0;

    for (const item of advice) {
      if (item.action === "steady") continue;
      try {
        await Reminder.create({
          farmer: req.userId,
          timelineRef: `listing:${item.listingId}`,
          cropType: item.cropType,
          type: "price_alert",
          title: ALERT_TITLES[item.action](item.cropType),
          message: item.headline,
          dedupeKey: `price:${item.listingId}:${item.action}:${today}`,
        });
        created += 1;
      } catch (error) {
        if (error.code !== 11000) console.error("price alert create error:", error);
      }
    }

    return res.status(200).json({ success: true, created });
  } catch (error) {
    console.error("generatePriceAlerts error:", error);
    return res.status(500).json({ success: false, message: "Failed to generate price alerts." });
  }
}

module.exports = {
  getPlantingSignals,
  getPriceForecast,
  getSellOrHold,
  generatePriceAlerts,
  getProfitPlan,
  // exported for tests
  computeDistrictSignals,
  classifySaturation,
  getPriceTrend,
};
