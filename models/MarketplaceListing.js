const mongoose = require("mongoose");

const MarketplaceListingSchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    timelineRef: { type: mongoose.Schema.Types.ObjectId, ref: "CultivationTimeline" },
    cropType: { type: String, required: true },
    quantityKg: { type: Number, required: true },
    originalPricePerKg: { type: Number, required: true },
    currentPricePerKg: { type: Number, required: true }, // may be marked down on re-tier
    harvestDate: { type: Date, required: true },
    qualityGrade: {
      type: String,
      enum: ["A", "B", "C"],
      default: "A",
    },
    photos: { type: [String], default: [] },

    // ---- MULTI-TIER MARKET VARIABLES ----
    tier: {
      type: String,
      enum: ["primary", "secondary"],
      default: "primary",
    },
    targetBuyerSegment: {
      type: [String],
      enum: ["supermarket", "hotel", "exporter", "factory", "restaurant", "compost_hub"],
      default: ["supermarket", "hotel", "exporter"],
    },
    rejectionHistory: {
      type: [
        {
          rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          reason: { type: String },
          defectType: {
            type: String,
            enum: ["visual_defect", "bruising", "size_mismatch", "underripe", "overripe", "other"],
          },
          rejectedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    markdownPercentApplied: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["listed", "reserved", "sold", "expired", "redirected"],
      default: "listed",
    },
    orderedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

MarketplaceListingSchema.index({ cropType: 1, tier: 1, status: 1 });
MarketplaceListingSchema.index({ farmer: 1 });

module.exports = mongoose.model("MarketplaceListing", MarketplaceListingSchema);
