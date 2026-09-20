const Advertisement = require("../models/Advertisement");

/**
 * POST /api/ads
 * Admin-only. Creates a new scheduled banner ad.
 */
async function createAd(req, res) {
  try {
    const {
      brandName,
      bannerImageUrl,
      clickThroughUrl,
      targetCropTypes,
      targetTimelinePhase,
      targetDistricts,
      scheduleStart,
      scheduleEnd,
      placements,
      category,
      headline,
      body,
      ctaLabel,
      accentColor,
      emoji,
    } = req.body;

    // An ad needs either a picture or a headline (ads without a picture are drawn from the text fields).
    if (!brandName || !(bannerImageUrl || headline) || !clickThroughUrl || !scheduleStart || !scheduleEnd) {
      return res.status(400).json({
        success: false,
        message: "brandName, (bannerImageUrl or headline), clickThroughUrl, scheduleStart, and scheduleEnd are required.",
      });
    }
    const validPlacements = ["marketplace", "logistics", "driver", "timeline", "scanner"];
    const chosenPlacements = Array.isArray(placements) && placements.length ? placements : ["marketplace"];
    if (!chosenPlacements.every((p) => validPlacements.includes(p))) {
      return res.status(400).json({ success: false, message: "Unknown ad placement." });
    }

    const ad = await Advertisement.create({
      brandName,
      bannerImageUrl: bannerImageUrl || "",
      clickThroughUrl,
      placements: chosenPlacements,
      ...(category ? { category } : {}),
      headline: headline || "",
      body: body || "",
      ...(ctaLabel ? { ctaLabel } : {}),
      ...(accentColor ? { accentColor } : {}),
      ...(emoji ? { emoji } : {}),
      targetCropTypes: targetCropTypes || [],
      targetTimelinePhase: targetTimelinePhase || [],
      targetDistricts: targetDistricts || [],
      scheduleStart,
      scheduleEnd,
      createdBy: req.userId,
    });

    return res.status(201).json({ success: true, data: ad });
  } catch (error) {
    console.error("createAd error:", error);
    return res.status(500).json({ success: false, message: "Failed to create ad.", error: error.message });
  }
}

/**
 * GET /api/ads
 * Public-ish read (farmer app calls this too, contextually filtered).
 * Query params: cropType, timelinePhase, district, activeOnly=true
 */
async function getAds(req, res) {
  try {
    const { cropType, timelinePhase, district, activeOnly, placement } = req.query;
    const filter = {};

    if (activeOnly === "true") {
      filter.isActive = true;
      filter.scheduleStart = { $lte: new Date() };
      filter.scheduleEnd = { $gte: new Date() };
    }
    // Ads made before placements existed have no placement field: they are marketplace ads.
    if (placement === "marketplace") filter.$or = [{ placements: "marketplace" }, { placements: { $exists: false } }];
    else if (placement) filter.placements = placement;
    if (cropType) filter.targetCropTypes = cropType;
    if (timelinePhase) filter.targetTimelinePhase = timelinePhase;
    if (district) filter.targetDistricts = district;

    const ads = await Advertisement.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: ads.length, data: ads });
  } catch (error) {
    console.error("getAds error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch ads.", error: error.message });
  }
}

/**
 * PATCH /api/ads/:id
 * Admin-only. Toggle active state or edit schedule/targeting.
 */
async function updateAd(req, res) {
  try {
    const { id } = req.params;
    const updates = req.body;

    const ad = await Advertisement.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
    if (!ad) {
      return res.status(404).json({ success: false, message: "Ad not found." });
    }
    return res.status(200).json({ success: true, data: ad });
  } catch (error) {
    console.error("updateAd error:", error);
    return res.status(500).json({ success: false, message: "Failed to update ad.", error: error.message });
  }
}

/**
 * DELETE /api/ads/:id
 * Admin-only.
 */
async function deleteAd(req, res) {
  try {
    const { id } = req.params;
    const ad = await Advertisement.findByIdAndDelete(id);
    if (!ad) {
      return res.status(404).json({ success: false, message: "Ad not found." });
    }
    return res.status(200).json({ success: true, message: "Ad deleted." });
  } catch (error) {
    console.error("deleteAd error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete ad.", error: error.message });
  }
}

/**
 * POST /api/ads/:id/impression
 * Fire-and-forget tracking call the mobile app makes when a banner is shown.
 */
async function trackImpression(req, res) {
  try {
    const placement = ["marketplace", "logistics", "driver", "timeline", "scanner"].includes((req.body || {}).placement) ? req.body.placement : null;
    await Advertisement.findByIdAndUpdate(req.params.id, { $inc: { impressions: 1, ...(placement ? { [`impressionsByPlacement.${placement}`]: 1 } : {}) } });
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to track impression." });
  }
}

/**
 * POST /api/ads/:id/click
 */
async function trackClick(req, res) {
  try {
    await Advertisement.findByIdAndUpdate(req.params.id, { $inc: { clicks: 1 } });
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to track click." });
  }
}

module.exports = { createAd, getAds, updateAd, deleteAd, trackImpression, trackClick };
