const mongoose = require("mongoose");

const AdvertisementSchema = new mongoose.Schema(
  {
    brandName: { type: String, required: true },
    bannerImageUrl: { type: String, required: true },
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
