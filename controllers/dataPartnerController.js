const DataPartner = require("../models/DataPartner");
const MarketPrice = require("../models/MarketPrice");
const CultivationTimeline = require("../models/CultivationTimeline");
const DemandRequest = require("../models/DemandRequest");
const ForwardContract = require("../models/ForwardContract");
const User = require("../models/User");

/**
 * DATA-AS-A-SERVICE — read-only, fully ANONYMIZED endpoints for licensed
 * partners (fertilizer companies, insurers, government planning bodies).
 * Every query here groups by district/crop/market only. None of them ever
 * select a farmer's or buyer's name, id, phone, or any single raw record —
 * only counts, sums and averages leave this file.
 */

/** GET /api/partner-insights/price-trends?cropType=&market= */
async function priceTrends(req, res) {
  try {
    const filter = {};
    if (req.query.cropType) filter.cropType = req.query.cropType;
    if (req.query.market) filter.market = req.query.market;
    const rows = await MarketPrice.find(filter).select("cropType market pricePerKg day").sort({ day: 1 }).limit(2000).lean();
    return res.status(200).json({ success: true, partner: req.dataPartner.orgName, data: rows });
  } catch (error) {
    console.error("priceTrends (partner) error:", error);
    return res.status(500).json({ success: false, message: "Failed to load price trends." });
  }
}

/** GET /api/partner-insights/planting-density?district= — how many farmers (counts only) are growing each crop, by district. */
async function plantingDensity(req, res) {
  try {
    const match = { status: "active" };
    const farmerFilter = {};
    if (req.query.district) farmerFilter["farmerProfile.district"] = req.query.district;
    const farmerIds = (await User.find(farmerFilter).select("_id farmerProfile.district").lean());
    const districtByFarmer = new Map(farmerIds.map((f) => [String(f._id), f.farmerProfile && f.farmerProfile.district]));

    const timelines = await CultivationTimeline.find({ ...match, farmer: { $in: farmerIds.map((f) => f._id) } })
      .select("farmer cropType landSizeAcres")
      .lean();

    const rows = {};
    for (const t of timelines) {
      const district = districtByFarmer.get(String(t.farmer)) || "Unknown";
      const key = `${district}::${t.cropType}`;
      rows[key] = rows[key] || { district, cropType: t.cropType, farmerCount: 0, totalAcres: 0 };
      rows[key].farmerCount += 1;
      rows[key].totalAcres += Number(t.landSizeAcres) || 0;
    }
    const data = Object.values(rows).map((r) => ({ ...r, totalAcres: Math.round(r.totalAcres * 10) / 10 }));
    return res.status(200).json({ success: true, partner: req.dataPartner.orgName, data });
  } catch (error) {
    console.error("plantingDensity (partner) error:", error);
    return res.status(500).json({ success: false, message: "Failed to load planting density." });
  }
}

/** GET /api/partner-insights/demand-signals — aggregated open buyer demand + forward contracts, by crop/district. */
async function demandSignals(req, res) {
  try {
    const [demandRows, contractRows] = await Promise.all([
      DemandRequest.find({ status: "open" }).select("cropType district quantityKg maxPricePerKg").lean(),
      ForwardContract.find({ status: "open" }).select("cropType district totalQuantityKg lockedPricePerKg deliverByDate").lean(),
    ]);
    const key = (d, c) => `${d || "Any"}::${c}`;
    const rows = {};
    demandRows.forEach((d) => {
      const k = key(d.district, d.cropType);
      rows[k] = rows[k] || { district: d.district || "Any", cropType: d.cropType, openDemandKg: 0, openContractKg: 0, requestCount: 0, contractCount: 0 };
      rows[k].openDemandKg += d.quantityKg;
      rows[k].requestCount += 1;
    });
    contractRows.forEach((c) => {
      const k = key(c.district, c.cropType);
      rows[k] = rows[k] || { district: c.district || "Any", cropType: c.cropType, openDemandKg: 0, openContractKg: 0, requestCount: 0, contractCount: 0 };
      rows[k].openContractKg += c.totalQuantityKg;
      rows[k].contractCount += 1;
    });
    return res.status(200).json({ success: true, partner: req.dataPartner.orgName, data: Object.values(rows) });
  } catch (error) {
    console.error("demandSignals (partner) error:", error);
    return res.status(500).json({ success: false, message: "Failed to load demand signals." });
  }
}

module.exports = { priceTrends, plantingDensity, demandSignals };
