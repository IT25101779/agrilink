const mongoose = require("mongoose");
const MarketplaceListing = require("../models/MarketplaceListing");

const SECONDARY_MARKUP_DOWN_PERCENT = 20; // discount applied when redirected to secondary tier
const MAX_TOTAL_MARKDOWN_PERCENT = 40; // cap so a farmer never loses more than 40% to rejections
const SECONDARY_SEGMENTS = ["factory", "restaurant", "compost_hub"];
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
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: listings.length, data: listings });
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
 * Core "Reject Redirection" mitigation logic. When a primary B2B buyer
 * rejects produce, the listing is automatically:
 *   1. logged with the rejection reason/defect,
 *   2. marked down 20% (stacking, capped at 40% total),
 *   3. moved from "primary" to "secondary" tier,
 *   4. re-targeted to factories / restaurants / compost hubs,
 *   5. re-opened as "listed" so it shows up on the secondary market feed.
 *
 * Guards added:
 *   - a farmer cannot reject their own listing,
 *   - sold / expired listings cannot be rejected,
 *   - if someone has reserved it, only THAT buyer can reject it,
 *   - the update is conditional, so two simultaneous rejections cannot
 *     both apply a markdown to the same listing.
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

    const newMarkdownPercent = Math.min(
      (listing.markdownPercentApplied || 0) + SECONDARY_MARKUP_DOWN_PERCENT,
      MAX_TOTAL_MARKDOWN_PERCENT
    );
    const newPrice = Math.round(listing.originalPricePerKg * (1 - newMarkdownPercent / 100) * 100) / 100;

    // Conditional update: only applies if nobody changed the listing since we read it.
    const updated = await MarketplaceListing.findOneAndUpdate(
      {
        _id: id,
        status: listing.status,
        markdownPercentApplied: listing.markdownPercentApplied || 0,
      },
      {
        $push: {
          rejectionHistory: {
            rejectedBy,
            reason,
            defectType: defectType || "other",
            rejectedAt: new Date(),
          },
        },
        $set: {
          markdownPercentApplied: newMarkdownPercent,
          currentPricePerKg: newPrice,
          tier: "secondary",
          targetBuyerSegment: SECONDARY_SEGMENTS,
          status: "listed",
        },
        $unset: { orderedBy: "" },
      },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(409).json({
        success: false,
        message: "This listing was just changed by someone else. Please refresh and try again.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Listing rejected and automatically redirected to secondary market tier.",
      data: updated,
    });
  } catch (error) {
    console.error("rejectAndRedirectListing error:", error);
    return res.status(500).json({ success: false, message: "Failed to process rejection.", error: error.message });
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

    const reserved = await MarketplaceListing.findOneAndUpdate(
      { _id: id, status: "listed", farmer: { $ne: buyerId } },
      { $set: { status: "reserved", orderedBy: buyerId } },
      { new: true }
    );

    if (reserved) {
      return res.status(200).json({ success: true, data: reserved });
    }

    // Nothing was updated — work out why so the message is accurate.
    const listing = await MarketplaceListing.findById(id);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }
    if (listing.farmer.toString() === String(buyerId)) {
      return res.status(403).json({ success: false, message: "You cannot buy your own listing." });
    }
    return res.status(409).json({ success: false, message: `Listing is not available (status: ${listing.status}).` });
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
      { $set: { status: "sold", soldAt: new Date() } },
      { new: true }
    );
    if (!sold) {
      return res.status(409).json({ success: false, message: "This order was just updated. Please refresh." });
    }

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
  confirmOrder,
  completeSale,
};
