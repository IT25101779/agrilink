const User = require("../models/User");
const MarketplaceListing = require("../models/MarketplaceListing");
const CultivationTimeline = require("../models/CultivationTimeline");
const GroupLot = require("../models/GroupLot");
const DemandRequest = require("../models/DemandRequest");
const CrowdfundingCampaign = require("../models/CrowdfundingCampaign");
const DiseaseLog = require("../models/DiseaseLog");
const { classifySaturation } = require("./insightsController");

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEKS_OF_TREND = 8;
const MIN_PLANTINGS_FOR_SIGNAL = 5; // same rule as the farmer-facing Oversupply Guard
const SMALL_CONTRIBUTION_KG = 100; // "small farmer" in a group lot = contributed 100 kg or less

function round(n) {
  return Math.round(n);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function sum(rows, fn) {
  return rows.reduce((total, row) => total + fn(row), 0);
}

/**
 * GET /api/admin/impact   (admin only)
 * The numbers behind "what has AgriLink achieved?". Everything is counted
 * straight from the database — nothing is estimated or invented. (With demo
 * data loaded, these are demo figures.)
 */
async function getImpact(req, res) {
  try {
    const now = Date.now();
    const [users, listings, timelines, lots, requests, campaigns, diseaseLogs] = await Promise.all([
      User.find({ role: { $in: ["farmer", "buyer"] } }).select("role").lean(),
      MarketplaceListing.find({}).select("status tier quantityKg currentPricePerKg rejectionHistory soldAt updatedAt").lean(),
      CultivationTimeline.find({}).select("status landSizeAcres").lean(),
      GroupLot.find({}).select("status committedKg members").lean(),
      DemandRequest.find({}).select("status quantityKg fulfilledKg offers").lean(),
      CrowdfundingCampaign.find({}).select("status amountRaisedLkr pledges").lean(),
      DiseaseLog.find({}).select("isPartOfOutbreakAlert district").lean(),
    ]);

    // ---- Sales ----
    const sold = listings.filter((l) => l.status === "sold");
    const valueOf = (l) => l.quantityKg * l.currentPricePerKg;

    // ---- Waste rescued: produce a buyer rejected that still found a buyer ----
    const wasRejected = (l) => (l.rejectionHistory || []).length > 0;
    const rescued = sold.filter((l) => l.tier === "secondary" || wasRejected(l));
    const redirectedTotal = listings.filter((l) => l.tier === "secondary" || wasRejected(l));
    const stillOnFlashSale = listings.filter((l) => l.tier === "secondary" && l.status === "listed");

    // ---- Group selling ----
    const claimedLots = lots.filter((l) => l.status === "claimed");
    const lotMembers = [];
    claimedLots.forEach((lot) => (lot.members || []).forEach((m) => lotMembers.push(m)));
    const farmersInGroupSales = new Set(lotMembers.map((m) => String(m.farmer)));
    const smallFarmers = new Set(lotMembers.filter((m) => m.quantityKg <= SMALL_CONTRIBUTION_KG).map((m) => String(m.farmer)));

    // ---- Demand board ----
    const allOffers = [];
    requests.forEach((r) => (r.offers || []).forEach((o) => allOffers.push(o)));

    // ---- Funding ----
    const funded = campaigns.filter((c) => ["funded", "repaid"].includes(c.status));
    const repaid = campaigns.filter((c) => c.status === "repaid");
    const investors = new Set();
    campaigns.forEach((c) => (c.pledges || []).forEach((p) => investors.add(String(p.investor))));

    // ---- Disease watch ----
    const outbreakLogs = diseaseLogs.filter((d) => d.isPartOfOutbreakAlert);
    const outbreakDistricts = new Set(outbreakLogs.map((d) => d.district).filter(Boolean));

    // ---- Weekly sales trend (last 8 weeks, oldest first) ----
    const weekly = [];
    for (let w = WEEKS_OF_TREND - 1; w >= 0; w--) {
      const end = now - w * 7 * MS_PER_DAY;
      const start = end - 7 * MS_PER_DAY;
      const inWeek = sold.filter((l) => {
        const t = new Date(l.soldAt || l.updatedAt).getTime();
        return t > start && t <= end;
      });
      weekly.push({
        weekEnding: new Date(end).toISOString().slice(0, 10),
        valueLkr: round(sum(inWeek, valueOf)),
        kg: round(sum(inWeek, (l) => l.quantityKg)),
        sales: inWeek.length,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        users: {
          farmers: users.filter((u) => u.role === "farmer").length,
          buyers: users.filter((u) => u.role === "buyer").length,
        },
        sales: {
          completed: sold.length,
          kgSold: round(sum(sold, (l) => l.quantityKg)),
          valueLkr: round(sum(sold, valueOf)),
        },
        wasteRescued: {
          kgRescued: round(sum(rescued, (l) => l.quantityKg)),
          valueLkr: round(sum(rescued, valueOf)),
          rescuedSales: rescued.length,
          listingsRedirected: redirectedTotal.length,
          kgWaitingOnFlashSale: round(sum(stillOnFlashSale, (l) => l.quantityKg)),
        },
        groupSelling: {
          lotsClaimed: claimedLots.length,
          kgPooled: round(sum(claimedLots, (l) => l.committedKg)),
          farmersParticipating: farmersInGroupSales.size,
          smallFarmersReachingBulkBuyers: smallFarmers.size,
        },
        demandBoard: {
          requestsPosted: requests.length,
          requestsOpen: requests.filter((r) => r.status === "open").length,
          kgRequested: round(sum(requests, (r) => r.quantityKg)),
          kgFulfilled: round(sum(requests, (r) => r.fulfilledKg || 0)),
          offersReceived: allOffers.length,
          offersAccepted: allOffers.filter((o) => o.status === "accepted").length,
        },
        funding: {
          campaigns: campaigns.length,
          campaignsFunded: funded.length,
          raisedLkr: round(sum(funded, (c) => c.amountRaisedLkr)),
          campaignsRepaid: repaid.length,
          investors: investors.size,
        },
        diseaseWatch: {
          scans: diseaseLogs.length,
          outbreakReports: outbreakLogs.length,
          districtsWithOutbreaks: outbreakDistricts.size,
        },
        farming: {
          activeTimelines: timelines.filter((t) => t.status === "active").length,
          completedTimelines: timelines.filter((t) => t.status === "completed").length,
          acresUnderManagement: round1(sum(timelines.filter((t) => t.status === "active"), (t) => Number(t.landSizeAcres) || 0)),
        },
        weekly,
      },
    });
  } catch (error) {
    console.error("getImpact error:", error);
    return res.status(500).json({ success: false, message: "Failed to load impact metrics." });
  }
}

/**
 * GET /api/admin/market-heatmap   (admin only)
 * Which crops are being grown where, right now, across all districts —
 * the same numbers the farmer-facing Oversupply Guard uses, for the whole country.
 */
async function getMarketHeatmap(req, res) {
  try {
    const now = new Date();
    const [farmers, timelines, demandRequests] = await Promise.all([
      User.find({ role: "farmer" }).select("farmerProfile.district").lean(),
      CultivationTimeline.find({ status: "active", expectedHarvestDate: { $gte: now } }).select("farmer cropType landSizeAcres").lean(),
      DemandRequest.find({ status: "open", neededBy: { $gte: now } }).select("cropType quantityKg fulfilledKg").lean(),
    ]);

    const districtOf = new Map(farmers.map((f) => [String(f._id), (f.farmerProfile && f.farmerProfile.district) || ""]));

    // district -> crop -> { farmers:Set, plantings, acres }
    const grid = new Map();
    for (const t of timelines) {
      const district = districtOf.get(String(t.farmer));
      if (!district) continue;
      if (!grid.has(district)) grid.set(district, new Map());
      const crops = grid.get(district);
      if (!crops.has(t.cropType)) crops.set(t.cropType, { farmers: new Set(), plantings: 0, acres: 0 });
      const cell = crops.get(t.cropType);
      cell.farmers.add(String(t.farmer));
      cell.plantings += 1;
      cell.acres += Number(t.landSizeAcres) || 0;
    }

    const districts = [];
    const cropTotals = new Map();
    const hotspots = [];

    for (const [district, crops] of grid.entries()) {
      const totalPlantings = [...crops.values()].reduce((total, c) => total + c.plantings, 0);
      const allFarmers = new Set();
      crops.forEach((c) => c.farmers.forEach((id) => allFarmers.add(id)));
      const enoughData = totalPlantings >= MIN_PLANTINGS_FOR_SIGNAL;

      const cropRows = [...crops.entries()]
        .map(([cropType, c]) => {
          const sharePercent = round1((c.plantings / totalPlantings) * 100);
          const level = enoughData ? classifySaturation({ farmers: c.farmers.size, sharePercent }) : "low";
          return { cropType, farmers: c.farmers.size, plantings: c.plantings, acres: round1(c.acres), sharePercent, level };
        })
        .sort((a, b) => b.farmers - a.farmers);

      cropRows.forEach((row) => {
        cropTotals.set(row.cropType, (cropTotals.get(row.cropType) || 0) + row.plantings);
        if (row.level === "high") hotspots.push({ district, cropType: row.cropType, farmers: row.farmers, sharePercent: row.sharePercent });
      });

      districts.push({ district, totalPlantings, totalFarmers: allFarmers.size, enoughData, crops: cropRows });
    }

    districts.sort((a, b) => b.totalPlantings - a.totalPlantings);
    hotspots.sort((a, b) => b.sharePercent - a.sharePercent);

    const topCrops = [...cropTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([cropType, plantings]) => ({ cropType, plantings }));

    const demandByCrop = new Map();
    for (const r of demandRequests) {
      const remaining = Math.max(0, r.quantityKg - (r.fulfilledKg || 0));
      demandByCrop.set(r.cropType, (demandByCrop.get(r.cropType) || 0) + remaining);
    }
    const demand = [...demandByCrop.entries()].map(([cropType, kg]) => ({ cropType, kgNeeded: round(kg) })).sort((a, b) => b.kgNeeded - a.kgNeeded);

    return res.status(200).json({
      success: true,
      data: { generatedAt: new Date().toISOString(), districts, topCrops, hotspots, demand },
    });
  } catch (error) {
    console.error("getMarketHeatmap error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the market heatmap." });
  }
}

module.exports = { getImpact, getMarketHeatmap };
