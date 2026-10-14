const mongoose = require("mongoose");
const MarketplaceListing = require("../models/MarketplaceListing");
const { computeFreshness } = require("../utils/shelfLife");
const { notifyFarmer } = require("../utils/notify");
const { logCommission } = require("../utils/commission");

const VALID_GRADES = ["A", "B", "C"];

function isValidId(id) {
  return typeof id === "string" && mongoose.isValidObjectId(id);
}

function isPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

/**
 * POST /api/marketplace/listings
 * Farmer creates a new primary-tier listing.
 */
async function createListing(req, res) {
  try {
    const { farmer, timelineRef, cropType, quantityKg, pricePerKg, harvestDate, qualityGrade, photos } = req.body;

    if (!farmer || !cropType || !quantityKg || !pricePerKg || !harvestDate) {
      return res.status(400).json({
        success: false,
        message: "farmer, cropType, quantityKg, pricePerKg, and harvestDate are required.",
      });
    }
    if (!isValidId(String(farmer))) {
      return res.status(400).json({ success: false, message: "farmer is not a valid user id." });
    }
    if (!isPositiveNumber(quantityKg) || !isPositiveNumber(pricePerKg)) {
      return res.status(400).json({ success: false, message: "quantityKg and pricePerKg must be positive numbers." });
    }
    if (Number.isNaN(new Date(harvestDate).getTime())) {
      return res.status(400).json({ success: false, message: "harvestDate is not a valid date." });
    }
    if (qualityGrade !== undefined && !VALID_GRADES.includes(qualityGrade)) {
      return res.status(400).json({ success: false, message: "qualityGrade must be A, B or C." });
    }

    const listing = await MarketplaceListing.create({
      farmer,
      timelineRef,
      cropType,
      quantityKg: Number(quantityKg),
      originalPricePerKg: Number(pricePerKg),
      currentPricePerKg: Number(pricePerKg),
      harvestDate,
      qualityGrade: qualityGrade || "A",
      photos: Array.isArray(photos) ? photos : [],
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
 * Supports filtering by tier, cropType, status, buyerSegment, orderedBy and
 * (new) farmer. The farmer filter lets the mobile app ask the server for
 * only ITS listings instead of downloading every listing in the system and
 * filtering on the phone.
 */
async function getListings(req, res) {
  try {
    const { tier, cropType, status, buyerSegment, orderedBy, farmer } = req.query;
    const filter = {};
    if (tier) filter.tier = tier;
    if (cropType) filter.cropType = cropType;
    if (status) filter.status = status;
    if (buyerSegment) filter.targetBuyerSegment = buyerSegment;
    if (orderedBy) {
      if (!isValidId(orderedBy)) return res.status(400).json({ success: false, message: "orderedBy is not a valid id." });
      filter.orderedBy = orderedBy;
    }
    if (farmer) {
      if (!isValidId(farmer)) return res.status(400).json({ success: false, message: "farmer is not a valid id." });
      filter.farmer = farmer;
    }

    const listings = await MarketplaceListing.find(filter)
      .populate("farmer", "fullName phone farmerProfile.district")
      .sort({ createdAt: -1 })
      .lean();

    // FRESHNESS CLOCK: attach the live freshness picture (days left, label,
    // and the current price after freshness) to every listing. Calculated at
    // request time, so it is always up to date and never stored.
    const now = new Date();
    const data = listings.map((listing) => ({ ...listing, freshness: computeFreshness(listing, now) }));

    return res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    console.error("getListings error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch listings.", error: error.message });
  }
}

/**
 * PATCH /api/marketplace/listings/:id
 * Lets the farmer who owns a listing edit it while it is still "listed".
 * Body: { farmerId, quantityKg?, pricePerKg?, harvestDate?, qualityGrade?, photos? }
 */
async function updateListing(req, res) {
  try {
    const { id } = req.params;
    const { farmerId, quantityKg, pricePerKg, harvestDate, qualityGrade, photos } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid listing id." });
    }
    if (!farmerId) {
      return res.status(400).json({ success: false, message: "farmerId is required to verify ownership." });
    }
    if (quantityKg !== undefined && !isPositiveNumber(quantityKg)) {
      return res.status(400).json({ success: false, message: "quantityKg must be a positive number." });
    }
    if (pricePerKg !== undefined && !isPositiveNumber(pricePerKg)) {
      return res.status(400).json({ success: false, message: "pricePerKg must be a positive number." });
    }
    if (qualityGrade !== undefined && !VALID_GRADES.includes(qualityGrade)) {
      return res.status(400).json({ success: false, message: "qualityGrade must be A, B or C." });
    }

    const listing = await MarketplaceListing.findById(id);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }
    if (listing.farmer.toString() !== String(farmerId)) {
      return res.status(403).json({ success: false, message: "You can only edit your own listings." });
    }
    if (listing.status !== "listed") {
      return res.status(409).json({
        success: false,
        message: `This listing can no longer be edited (status: ${listing.status}).`,
      });
    }

    if (quantityKg !== undefined) listing.quantityKg = Number(quantityKg);
    if (qualityGrade !== undefined) listing.qualityGrade = qualityGrade;
    if (harvestDate !== undefined) listing.harvestDate = harvestDate;
    if (photos !== undefined) listing.photos = photos;

    // An explicit price edit becomes the new real price (not a discount off
    // an earlier number), so the markdown history is reset.
    if (pricePerKg !== undefined) {
      listing.originalPricePerKg = Number(pricePerKg);
      listing.currentPricePerKg = Number(pricePerKg);
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
 * REDESIGNED (Oct 2026) to close a real abuse loophole that was flagged:
 * "Buyers could falsely reject produce to get a discount." The OLD
 * behaviour auto-applied a 20% markdown and moved the listing to the
 * public secondary tier the instant ANY buyer rejected it — so a buyer
 * (or a buyer colluding with someone else) could reject perfectly good
 * produce purely to force a cheaper price for everyone, including
 * themselves on a later purchase.
 *
 * NEW behaviour (matches what was asked for):
 *   1. The rejection is only ever LOGGED (reason, defect type, who, when).
 *   2. The price and tier of the listing are NOT touched automatically —
 *      every other buyer still sees the original listing at the original
 *      price on the normal marketplace.
 *   3. The farmer is notified with the rejection count and reasons so far.
 *   4. The rejecting buyer — and only them — can now also see this exact
 *      listing surfaced in their personal "Secondary market" view
 *      (see getMySecondaryMarket below), in case the farmer later drops
 *      the price for it.
 *   5. ONLY the farmer can actually lower the price (via the existing
 *      updateListing endpoint, which they already own) — and when they
 *      do, that new price is the one everyone sees, not a hidden
 *      discount manufactured by a rejection.
 *   6. If the rejecting buyer had this listing reserved, the reservation
 *      is released back to "listed" so other buyers can still buy it —
 *      but, again, at the unchanged price.
 */
async function rejectAndRedirectListing(req, res) {
  try {
    const { id } = req.params;
    const { rejectedBy, reason, defectType } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid listing id." });
    }
    if (!rejectedBy || !reason) {
      return res.status(400).json({
        success: false,
        message: "rejectedBy and reason are required to process a rejection.",
      });
    }
    if (!isValidId(String(rejectedBy))) {
      return res.status(400).json({ success: false, message: "rejectedBy is not a valid user id." });
    }

    const listing = await MarketplaceListing.findById(id);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }
    if (listing.farmer.toString() === String(rejectedBy)) {
      return res.status(403).json({ success: false, message: "You cannot reject your own listing." });
    }
    if (!["listed", "reserved"].includes(listing.status)) {
      return res.status(409).json({
        success: false,
        message: `This listing can no longer be rejected (status: ${listing.status}).`,
      });
    }
    if (listing.status === "reserved" && listing.orderedBy && listing.orderedBy.toString() !== String(rejectedBy)) {
      return res.status(403).json({ success: false, message: "This listing is reserved by another buyer." });
    }
    // One rejection per buyer per listing — stops the same buyer inflating the count.
    const alreadyRejectedByThisBuyer = listing.rejectionHistory.some((r) => String(r.rejectedBy) === String(rejectedBy));
    if (alreadyRejectedByThisBuyer) {
      return res.status(409).json({ success: false, message: "You've already rejected this listing." });
    }

    const wasReservedByRejecter = listing.status === "reserved";

    const updated = await MarketplaceListing.findOneAndUpdate(
      { _id: id, status: listing.status },
      {
        $push: {
          rejectionHistory: {
            rejectedBy,
            reason,
            defectType: defectType || "other",
            rejectedAt: new Date(),
          },
        },
        // Releases the listing back onto the open market if the rejecting
        // buyer had it reserved — price and tier are left exactly as they were.
        ...(wasReservedByRejecter ? { $set: { status: "listed" }, $unset: { orderedBy: "" } } : {}),
      },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(409).json({
        success: false,
        message: "This listing was just changed by someone else. Please refresh and try again.",
      });
    }

    const rejectionCount = updated.rejectionHistory.length;
    const recentReasons = updated.rejectionHistory.slice(-3).map((r) => r.reason).join("; ");
    await notifyFarmer(updated.farmer, {
      type: "order_update",
      dedupeKey: `reject-${updated._id}-${rejectionCount}`,
      title: `${rejectionCount} buyer${rejectionCount > 1 ? "s" : ""} rejected your ${updated.cropType}`,
      message: `Reason(s): ${recentReasons}. The price has NOT changed automatically — it only shows at a lower price to buyers who rejected it if you choose to drop it yourself.`,
      cropType: updated.cropType,
    });

    return res.status(200).json({
      success: true,
      message: "Rejection recorded. The farmer has been notified — the price was not changed automatically.",
      data: updated,
    });
  } catch (error) {
    console.error("rejectAndRedirectListing error:", error);
    return res.status(500).json({ success: false, message: "Failed to process rejection.", error: error.message });
  }
}

/**
 * GET /api/marketplace/listings/secondary-for-me
 * A buyer's personal "second chance" market: every still-available listing
 * THEY rejected, so they can come back if the farmer later drops the price.
 * Nobody else sees a listing here just because somebody else rejected it —
 * that's the fix for the "fake rejection to get a cheap price for everyone"
 * loophole.
 */
async function getMySecondaryMarket(req, res) {
  try {
    const listings = await MarketplaceListing.find({
      "rejectionHistory.rejectedBy": req.userId,
      status: "listed",
    })
      .populate("farmer", "fullName phone farmerProfile.district")
      .sort({ updatedAt: -1 })
      .lean();

    const now = new Date();
    const data = listings.map((listing) => {
      const myRejections = listing.rejectionHistory.filter((r) => String(r.rejectedBy) === String(req.userId));
      return { ...listing, freshness: computeFreshness(listing, now), myRejectionReasons: myRejections.map((r) => r.reason) };
    });

    return res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    console.error("getMySecondaryMarket error:", error);
    return res.status(500).json({ success: false, message: "Failed to load your secondary market.", error: error.message });
  }
}

/**
 * PATCH /api/marketplace/listings/:id/confirm-order
 * Buyer reserves a listing. Done as ONE atomic database operation
 * ("reserve it only if it is still listed"), so two buyers tapping
 * Confirm at the same moment can never both get the same produce.
 */
async function confirmOrder(req, res) {
  try {
    const { id } = req.params;
    const { buyerId } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid listing id." });
    }
    if (!buyerId || !isValidId(String(buyerId))) {
      return res.status(400).json({ success: false, message: "A valid buyerId is required." });
    }

    const existing = await MarketplaceListing.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }
    if (existing.farmer.toString() === String(buyerId)) {
      return res.status(403).json({ success: false, message: "You cannot buy your own listing." });
    }

    // FRESHNESS CLOCK: produce past its sell-by window can no longer be sold
    // as fresh primary-market stock. It is still available in the Secondary
    // Market (factories / restaurants / compost hubs) at the reduced price.
    const freshness = computeFreshness(existing);
    if (freshness.expired && existing.tier === "primary") {
      return res.status(409).json({
        success: false,
        message: "This produce has passed its freshness window. It can now only be bought through the Secondary Market.",
      });
    }

    const reserved = await MarketplaceListing.findOneAndUpdate(
      { _id: id, status: "listed", farmer: { $ne: buyerId } },
      // agreedPricePerKg locks in today's freshness-adjusted price, so the
      // buyer pays what they saw when they tapped Confirm.
      { $set: { status: "reserved", orderedBy: buyerId, agreedPricePerKg: freshness.effectivePricePerKg } },
      { new: true }
    );

    if (reserved) {
      return res.status(200).json({ success: true, data: reserved });
    }

    // Nothing was updated — work out why so the message is accurate.
    // Someone else reserved it (or its status changed) between our read and write.
    const latest = await MarketplaceListing.findById(id);
    return res.status(409).json({
      success: false,
      message: `Listing is not available (status: ${latest ? latest.status : "removed"}).`,
    });
  } catch (error) {
    console.error("confirmOrder error:", error);
    return res.status(500).json({ success: false, message: "Failed to confirm order.", error: error.message });
  }
}

/**
 * PATCH /api/marketplace/listings/:id/complete-sale
 * Marks a reserved order as sold. Only the listing's farmer or the buyer
 * who reserved it may do this (previously any user id was accepted).
 * Body: { confirmedBy }
 */
async function completeSale(req, res) {
  try {
    const { id } = req.params;
    const { confirmedBy } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid listing id." });
    }
    if (!confirmedBy || !isValidId(String(confirmedBy))) {
      return res.status(400).json({ success: false, message: "A valid confirmedBy user id is required." });
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

    const isFarmer = listing.farmer.toString() === String(confirmedBy);
    const isBuyer = listing.orderedBy && listing.orderedBy.toString() === String(confirmedBy);
    if (!isFarmer && !isBuyer) {
      return res.status(403).json({
        success: false,
        message: "Only the farmer or the buyer of this order can complete the sale.",
      });
    }

    const sold = await MarketplaceListing.findOneAndUpdate(
      { _id: id, status: "reserved" },
      {
        $set: {
          status: "sold",
          soldAt: new Date(),
          // Record the REAL price the produce sold for (after any freshness
          // discount), so price prediction learns from true sale prices.
          ...(listing.agreedPricePerKg ? { currentPricePerKg: listing.agreedPricePerKg } : {}),
        },
      },
      { new: true }
    );
    if (!sold) {
      return res.status(409).json({ success: false, message: "This order was just updated. Please refresh." });
    }

    // 5% platform commission on the completed deal (flat small fee instead,
    // under LKR 1000) — bookkeeping only, no money actually moves here.
    const saleValueLkr = (sold.agreedPricePerKg || sold.currentPricePerKg) * sold.quantityKg;
    await logCommission({ source: "marketplace_sale", refId: sold._id, farmer: sold.farmer, amountLkr: saleValueLkr });

    return res.status(200).json({ success: true, message: "Sale completed.", data: sold });
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
  getMySecondaryMarket,
  confirmOrder,
  completeSale,
};
