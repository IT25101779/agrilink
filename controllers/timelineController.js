const CultivationTimeline = require("../models/CultivationTimeline");

/**
 * POST /api/timelines/sync-queue
 *
 * This is the endpoint SyncService (mobile) has been calling all along —
 * see agrilink_mobile/lib/services/sync_service.dart.
 *
 * SECURITY FIX (Oct 2026): this used to trust req.body.farmer completely.
 * A buggy or stale client could push a timeline tagged with someone ELSE's
 * farmer id, and it would be saved under that id. We now always use the
 * logged-in user's own id (req.userId, set by the `protect` + `bindIdentity`
 * middleware) and ignore whatever "farmer" the client body claims to be.
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

    // Always the logged-in user — never trust a client-supplied farmer id.
    const farmer = req.userId;

    if (!localId || !farmer || !cropType || !landSizeAcres || !soilType || !gpsLocation || !plantingDate || !expectedHarvestDate) {
      return res.status(400).json({
        success: false,
        message:
          "localId, cropType, landSizeAcres, soilType, gpsLocation, plantingDate, and expectedHarvestDate are required.",
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
 * GET /api/timelines/mine?status=active
 *
 * SECURITY FIX (Oct 2026): this used to take `farmerId` straight from the
 * query string and fetch WHOEVER'S timelines were asked for — any logged-in
 * user could read any other farmer's full cultivation history. It now
 * always scopes to the logged-in user (req.userId). An admin may still pass
 * ?farmerId=... explicitly for oversight/support; everyone else gets their
 * own data regardless of what's in the query string.
 */
async function getMyTimelines(req, res) {
  try {
    const { status } = req.query;
    const isAdmin = req.userRole === "admin";
    const farmerId = isAdmin && req.query.farmerId ? req.query.farmerId : req.userId;

    const filter = { farmer: farmerId };
    if (status) filter.status = status;

    const timelines = await CultivationTimeline.find(filter).sort({ updatedAt: -1 });
    return res.status(200).json({ success: true, count: timelines.length, data: timelines });
  } catch (error) {
    console.error("getMyTimelines error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch timelines.", error: error.message });
  }
}

/**
 * DELETE /api/timelines/:localId
 * A farmer deleting their own timeline (confirmed on the mobile side first).
 * Only ever deletes a record that belongs to the logged-in user — never
 * trusts anything from the body, only the authenticated id and the localId
 * in the URL.
 */
async function deleteTimeline(req, res) {
  try {
    const { localId } = req.params;
    const farmer = req.userId;
    const deleted = await CultivationTimeline.findOneAndDelete({ localId, farmer });
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Timeline not found, or it isn't yours." });
    }
    return res.status(200).json({ success: true, message: "Timeline deleted." });
  } catch (error) {
    console.error("deleteTimeline error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete timeline.", error: error.message });
  }
}

module.exports = { syncTimeline, getMyTimelines, deleteTimeline };
