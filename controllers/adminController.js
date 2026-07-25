const User = require("../models/User");
const CultivationTimeline = require("../models/CultivationTimeline");
const MarketplaceListing = require("../models/MarketplaceListing");
const DiseaseLog = require("../models/DiseaseLog");
const Advertisement = require("../models/Advertisement");

/**
 * GET /api/admin/metrics
 * Single aggregation call the admin dashboard loads on mount — returns
 * everything needed for the overview cards and charts in one round trip.
 */
async function getMetrics(req, res) {
  try {
    const [
      totalFarmers,
      totalBuyers,
      totalDrivers,
      activeTimelines,
      completedTimelines,
      listingsByTier,
      listingsByStatus,
      totalDiseaseLogs,
      activeOutbreakClusters,
      soldListingsValue,
      activeAdsCount,
      recentListings,
    ] = await Promise.all([
      User.countDocuments({ role: "farmer" }),
      User.countDocuments({ role: "buyer" }),
      User.countDocuments({ role: "driver" }),
      CultivationTimeline.countDocuments({ status: "active" }),
      CultivationTimeline.countDocuments({ status: "completed" }),
      MarketplaceListing.aggregate([{ $group: { _id: "$tier", count: { $sum: 1 } } }]),
      MarketplaceListing.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      DiseaseLog.countDocuments({}),
      DiseaseLog.aggregate([
        { $match: { isPartOfOutbreakAlert: true } },
        { $group: { _id: { cropType: "$cropType", disease: "$detectedDisease" } } },
        { $count: "clusterCount" },
      ]),
      MarketplaceListing.aggregate([
        { $match: { status: "sold" } },
        { $group: { _id: null, totalValue: { $sum: { $multiply: ["$currentPricePerKg", "$quantityKg"] } } } },
      ]),
      Advertisement.countDocuments({ isActive: true, scheduleEnd: { $gte: new Date() } }),
      MarketplaceListing.find().sort({ createdAt: -1 }).limit(8).populate("farmer", "fullName"),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        users: { farmers: totalFarmers, buyers: totalBuyers, drivers: totalDrivers },
        timelines: { active: activeTimelines, completed: completedTimelines },
        listingsByTier: Object.fromEntries(listingsByTier.map((r) => [r._id, r.count])),
        listingsByStatus: Object.fromEntries(listingsByStatus.map((r) => [r._id, r.count])),
        disease: {
          totalLogs: totalDiseaseLogs,
          activeOutbreakClusters: activeOutbreakClusters[0]?.clusterCount || 0,
        },
        marketplace: {
          totalSoldValueLkr: soldListingsValue[0]?.totalValue || 0,
        },
        activeAdsCount,
        recentListings,
      },
    });
  } catch (error) {
    console.error("getMetrics error:", error);
    return res.status(500).json({ success: false, message: "Failed to load metrics.", error: error.message });
  }
}

module.exports = { getMetrics };
