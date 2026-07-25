const mongoose = require("mongoose");

const DiseaseLogSchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    timelineRef: { type: mongoose.Schema.Types.ObjectId, ref: "CultivationTimeline" },
    cropType: { type: String, required: true },
    imageUrl: { type: String, required: true },
    detectedDisease: { type: String, required: true },
    confidenceScore: { type: Number, required: true, min: 0, max: 1 },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    district: { type: String },
    recommendedTreatment: { type: String },
    isPartOfOutbreakAlert: { type: Boolean, default: false },
    outbreakAlertRef: { type: mongoose.Schema.Types.ObjectId, ref: "OutbreakAlert" },
  },
  { timestamps: true }
);

DiseaseLogSchema.index({ location: "2dsphere" });
DiseaseLogSchema.index({ cropType: 1, detectedDisease: 1, createdAt: -1 });

module.exports = mongoose.model("DiseaseLog", DiseaseLogSchema);
