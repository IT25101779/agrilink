const mongoose = require("mongoose");

const AdvertisementSchema = new mongoose.Schema(
  {
    brandName: { type: String, required: true },
    bannerImageUrl: { type: String, default: "" }, // optional: ads without a picture are drawn from the fields below
    // Where the ad is shown, and how it looks when there is no picture.
    placements: { type: [String], enum: ["marketplace", "logistics", "driver", "timeline", "scanner"], default: ["marketplace"] },
    category: { type: String, enum: ["general", "fuel", "tyres", "insurance", "vehicle", "seeds", "fertilizer", "equipment", "finance", "cold_storage"], default: "general" },
    headline: { type: String, default: "", maxlength: 80 },
    body: { type: String, default: "", maxlength: 160 },
    ctaLabel: { type: String, default: "Learn more", maxlength: 24 },
    accentColor: { type: String, default: "#0B5D3B" },
    emoji: { type: String, default: "📢", maxlength: 4 },
    impressionsByPlacement: { type: mongoose.Schema.Types.Mixed, default: {} },
    clickThroughUrl: { type: String, required: true },
    targetCropTypes: { type: [String], default: [] }, // e.g. ["paddy", "tomato"]
    targetTimelinePhase: {
      type: [String],
      enum: ["land_prep", "planting", "growth", "pest_control", "harvest", "post_harvest"],
      default: [],
    },
    targetDistricts: { type: [String], default: [] },
    scheduleStart: { type: Date, required: true },
    scheduleEnd: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

AdvertisementSchema.index({ isActive: 1, scheduleStart: 1, scheduleEnd: 1 });

module.exports = mongoose.model("Advertisement", AdvertisementSchema);
