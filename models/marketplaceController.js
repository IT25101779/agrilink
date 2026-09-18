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
 * PATCH /api/marketplace/listings/:id
 * Lets the farmer who owns a listing edit it — quantity, their asking
 * price, harvest date, quality grade, or photos. Previously there was no
 * way for a farmer to change anything after posting, including the price
 * (only the automatic reject-markdown could change it). Only allowed
 * while the listing is still "listed" — once it's reserved or sold,
 * editing the terms out from under a buyer would be a real problem, so
 * that's blocked here rather than left to the frontend to enforce.
 *
 * Body: { farmerId, quantityKg?, pricePerKg?, harvestDate?, qualityGrade?, photos? }
 * farmerId must match the listing's owner — this API has no auth
 * middleware on it (consistent with the rest of this router), so
 * ownership is checked explicitly here rather than assumed.
 */
async function updateListing(req, res) {
  try {
    const { id } = req.params;
    const { farmerId, quantityKg, pricePerKg, harvestDate, qualityGrade, photos } = req.body;

    if (!farmerId) {
      return res.status(400).json({ success: false, message: "farmerId is required to verify ownership." });
    }

    const listing = await MarketplaceListing.findById(id);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }
    if (listing.farmer.toString() !== farmerId) {
      return res.status(403).json({ success: false, message: "You can only edit your own listings." });
    }
    if (listing.status !== "listed") {
      return res.status(409).json({
        success: false,
        message: `This listing can no longer be edited (status: ${listing.status}).`,
      });
    }

    if (quantityKg !== undefined) listing.quantityKg = quantityKg;
    if (qualityGrade !== undefined) listing.qualityGrade = qualityGrade;
    if (harvestDate !== undefined) listing.harvestDate = harvestDate;
    if (photos !== undefined) listing.photos = photos;

    // Editing price is deliberately farmer-controlled and independent of
    // the automatic reject-markdown system: this sets BOTH the original
    // and current price directly to whatever the farmer asks for, since
    // an explicit edit means the farmer wants that to be the real price
    // going forward, not a discount off some earlier number. If the
    // listing later gets rejected, the markdown still applies as normal,
    // calculated off this new original price.
    if (pricePerKg !== undefined) {
      listing.originalPricePerKg = pricePerKg;
      listing.currentPricePerKg = pricePerKg;
      listing.markdownPercentApplied = 0;
    }

    await listing.save();

    return res.status(200).json({ success: true, data: listing });
  } catch (error) {
    console.error("updateListing error:", error);
    return res.status(500).json({ success: false, message: "Failed to update listing.", error: error.message });
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
 * This RESERVES the listing — it does not yet count as a completed sale.
 * See completeSale() for the step that actually finalizes it.
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

/**
 * PATCH /api/marketplace/listings/:id/complete-sale
 *
 * IMPORTANT — this endpoint fixes a real bug: without a "reserved" ->
 * "sold" transition existing ANYWHERE in the app, no listing could ever
 * reach status "sold". Two things silently broke as a result:
 *   1. AI price prediction (utils/pricePredictionEngine.js) bases its
 *      estimate on the average of recently SOLD listings — with zero
 *      sold listings ever existing, it always fell back to a flat
 *      LKR 100 baseline, regardless of crop.
 *   2. The admin dashboard's "Gross Marketplace Value" metric
 *      (controllers/adminController.js) sums currentPricePerKg *
 *      quantityKg for status: "sold" listings — always LKR 0.
 *
 * Either the buyer or the farmer can call this once a reserved order has
 * actually been paid for / handed over — there's no payment gateway
 * behind this yet (matching the rest of this prototype's honest scope),
 * so it's a manual confirmation step, not an automatic one triggered by
 * a real transaction.
 *
 * Body: { confirmedBy } — the user ID marking it complete, logged but
 * not restricted to farmer-only or buyer-only, since either party
 * reasonably needs to be able to close out a sale.
 */
async function completeSale(req, res) {
  try {
    const { id } = req.params;
    const { confirmedBy } = req.body;

    if (!confirmedBy) {
      return res.status(400).json({ success: false, message: "confirmedBy is required." });
    }

    const listing = await MarketplaceListing.findById(id);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }
    if (listing.status !== "reserved") {
      return res.status(409).json({
        success: false,
        message: `Only a reserved listing can be marked sold (status: ${listing.status}).`,
      });
    }

    listing.status = "sold";
    listing.soldAt = new Date();
    await listing.save();

    return res.status(200).json({ success: true, message: "Sale completed.", data: listing });
  } catch (error) {
    console.error("completeSale error:", error);
    return res.status(500).json({ success: false, message: "Failed to complete sale.", error: error.message });
  }
}

module.exports = {
  createListing,
  getListings,
  updateListing,
  rejectAndRedirectListing,
  confirmOrder,
  completeSale,
};
