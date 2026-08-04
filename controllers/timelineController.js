const CultivationTimeline = require("../models/CultivationTimeline");

/**
 * POST /api/timelines/sync-queue
 *
 * This is the endpoint SyncService (mobile) has been calling all along —
 * see agrilink_mobile/lib/services/sync_service.dart. Until now the route
 * didn't exist, so every "pending" offline timeline stayed pending forever
 * (SyncService silently swallows non-200/201 responses and retries later,
 * which is why nothing broke — it just never actually synced).
 *
 * Body shape matches TimelineModel.toSyncJson() exactly:
 * { localId, farmer, cropType, landSizeAcres, soilType,
 *   gpsLocation: { type: "Point", coordinates: [lng, lat] },
 *   plantingDate, expectedHarvestDate, milestones, status,
 *   lastLocalModifiedAt }
 *
 * Upserts by the (localId, farmer) compound key already indexed as unique
 * on CultivationTimeline. Conflict rule (per ARCHITECTURE.md — "last-write-
 * wins"): if a record already exists for this localId, the incoming push
 * only overwrites it when its lastLocalModifiedAt is newer than what's
 * stored. This protects against an older/slow device re-pushing stale data
 * over a newer edit that already synced from another session.
 */
async function syncTimeline(req, res) {
  try {
    const {
      localId,
      farmer,
      cropType,
      landSizeAcres,
      soilType,
      gpsLocation,
      plantingDate,
      expectedHarvestDate,
      milestones,
      status,
      lastLocalModifiedAt,
    } = req.body;

    if (!localId || !farmer || !cropType || !landSizeAcres || !soilType || !gpsLocation || !plantingDate || !expectedHarvestDate) {
      return res.status(400).json({
        success: false,
        message:
          "localId, farmer, cropType, landSizeAcres, soilType, gpsLocation, plantingDate, and expectedHarvestDate are required.",
      });
    }

    const incomingModifiedAt = lastLocalModifiedAt ? new Date(lastLocalModifiedAt) : new Date();

    const existing = await CultivationTimeline.findOne({ localId, farmer });

    // Existing record is newer than (or equal to) what this device is
    // pushing — nothing to do, just confirm the current server state so
    // the device can still mark itself "synced" and stop retrying.
    if (existing && existing.lastLocalModifiedAt && existing.lastLocalModifiedAt >= incomingModifiedAt) {
      return res.status(200).json({
        success: true,
        message: "Server already has an equal-or-newer version of this timeline. No changes applied.",
        data: existing,
      });
    }

    const update = {
      farmer,
      cropType,
      landSizeAcres,
      soilType,
      gpsLocation,
      plantingDate,
      expectedHarvestDate,
      milestones: milestones || [],
      status: status || "active",
      localId,
      syncStatus: "synced",
      lastLocalModifiedAt: incomingModifiedAt,
      lastSyncedAt: new Date(),
    };

    const timeline = await CultivationTimeline.findOneAndUpdate(
      { localId, farmer },
      update,
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: existing ? "Timeline updated from device sync." : "Timeline created from device sync.",
      data: timeline,
    });
  } catch (error) {
    console.error("syncTimeline error:", error);
    return res.status(500).json({ success: false, message: "Failed to sync timeline.", error: error.message });
  }
}

/**
 * GET /api/timelines/mine?farmerId=X&status=active
 * Lets a farmer (or the admin dashboard) fetch the server's copy of a
 * farmer's synced timelines — useful once a farmer switches devices, or
 * for any future feature that needs to read timeline data server-side.
 */
async function getMyTimelines(req, res) {
  try {
    const { farmerId, status } = req.query;
    if (!farmerId) {
      return res.status(400).json({ success: false, message: "farmerId is required." });
    }

    const filter = { farmer: farmerId };
    if (status) filter.status = status;

    const timelines = await CultivationTimeline.find(filter).sort({ updatedAt: -1 });
    return res.status(200).json({ success: true, count: timelines.length, data: timelines });
  } catch (error) {
    console.error("getMyTimelines error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch timelines.", error: error.message });
  }
}

module.exports = { syncTimeline, getMyTimelines };
