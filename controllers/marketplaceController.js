const MarketplaceListing = require("../models/MarketplaceListing");

const SECONDARY_MARKUP_DOWN_PERCENT = 20; // discount applied when redirected to secondary tier
const SECONDARY_SEGMENTS = ["factory", "restaurant", "compost_hub"];

/**
 * POST /api/marketplace/listings
 * Farmer creates a new primary-tier listing.
 */
async function createListing(req, res) {
  try {
    const {
      farmer,
      timelineRef,
      cropType,
      quantityKg,
      pricePerKg,
      harvestDate,
      qualityGrade,
      photos,
    } = req.body;

    if (!farmer || !cropType || !quantityKg || !pricePerKg || !harvestDate) {
      return res.status(400).json({
        success: false,
        message: "farmer, cropType, quantityKg, pricePerKg, and harvestDate are required.",
      });
    }

    const listing = await MarketplaceListing.create({
      farmer,
      timelineRef,
      cropType,
      quantityKg,
      originalPricePerKg: pricePerKg,
      currentPricePerKg: pricePerKg,
      harvestDate,
      qualityGrade: qualityGrade || "A",
      photos: photos || [],
      tier: "primary",
      targetBuyerSegment: ["supermarket", "hotel", "exporter"],
      status: "listed",
    });

    return res.status(201).json({ success: true, data: listing });
  } catch (error) {
    console.error("createListing error:", error);
    return res.status(500).json({ success: false, message: "Failed to create listing.", error: error.message });
  }
}

/**
 * GET /api/marketplace/listings
 * Supports filtering by tier, cropType, status. Used by both the primary
 * B2B buyer portal (tier=primary) and the secondary flash-sale view (tier=secondary).
 */
async function getListings(req, res) {
  try {
    const { tier, cropType, status, buyerSegment, orderedBy } = req.query;
    const filter = {};
    if (tier) filter.tier = tier;
    if (cropType) filter.cropType = cropType;
    if (status) filter.status = status;
    if (buyerSegment) filter.targetBuyerSegment = buyerSegment;
    if (orderedBy) filter.orderedBy = orderedBy;

    const listings = await MarketplaceListing.find(filter)
      .populate("farmer", "fullName phone farmerProfile.district")
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: listings.length, data: listings });
  } catch (error) {
    console.error("getListings error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch listings.", error: error.message });
  }
}

/**
 * PATCH /api/marketplace/listings/:id/reject
 *
 * Core "Reject Redirection" mitigation logic:
 * When a primary B2B buyer rejects a listing, this automatically:
 *   1. Logs the rejection reason/defect type into rejectionHistory.
 *   2. Applies a markdown to currentPricePerKg (20% off original, stacking capped at 40%).
 *   3. Re-tiers the listing from "primary" to "secondary".
 *   4. Reassigns targetBuyerSegment to factories/restaurants/compost hubs.
 *   5. Resets status back to "listed" so it becomes visible on the secondary market feed.
 */
async function rejectAndRedirectListing(req, res) {
  try {
    const { id } = req.params;
    const { rejectedBy, reason, defectType } = req.body;

    if (!rejectedBy || !reason) {
      return res.status(400).json({
        success: false,
        message: "rejectedBy and reason are required to process a rejection.",
      });
    }

    const listing = await MarketplaceListing.findById(id);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }

    // 1. Log the rejection event
    listing.rejectionHistory.push({
      rejectedBy,
      reason,
      defectType: defectType || "other",
      rejectedAt: new Date(),
    });

    // 2. Compute and apply markdown (cap total markdown at 40% to protect farmer income)
    const newMarkdownPercent = Math.min(
      listing.markdownPercentApplied + SECONDARY_MARKUP_DOWN_PERCENT,
      40
    );
    listing.markdownPercentApplied = newMarkdownPercent;
    listing.currentPricePerKg =
      Math.round(listing.originalPricePerKg * (1 - newMarkdownPercent / 100) * 100) / 100;

    // 3. Re-tier to secondary market
    listing.tier = "secondary";

    // 4. Reassign target buyer segment to secondary-market participants
    listing.targetBuyerSegment = SECONDARY_SEGMENTS;

    // 5. Re-open listing for secondary market visibility
    listing.status = "listed";
    listing.orderedBy = undefined;

    await listing.save();

    return res.status(200).json({
      success: true,
      message: "Listing rejected and automatically redirected to secondary market tier.",
      data: listing,
    });
  } catch (error) {
    console.error("rejectAndRedirectListing error:", error);
    return res.status(500).json({ success: false, message: "Failed to process rejection.", error: error.message });
  }
}

/**
 * PATCH /api/marketplace/listings/:id/confirm-order
 * Buyer confirms purchase of a listing (primary or secondary tier).
 */
async function confirmOrder(req, res) {
  try {
    const { id } = req.params;
    const { buyerId } = req.body;

    if (!buyerId) {
      return res.status(400).json({ success: false, message: "buyerId is required." });
    }

    const listing = await MarketplaceListing.findById(id);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }
    if (listing.status !== "listed") {
      return res.status(409).json({ success: false, message: `Listing is not available (status: ${listing.status}).` });
    }

    listing.status = "reserved";
    listing.orderedBy = buyerId;
    await listing.save();

    return res.status(200).json({ success: true, data: listing });
  } catch (error) {
    console.error("confirmOrder error:", error);
    return res.status(500).json({ success: false, message: "Failed to confirm order.", error: error.message });
  }
}

module.exports = {
  createListing,
  getListings,
  rejectAndRedirectListing,
  confirmOrder,
};
