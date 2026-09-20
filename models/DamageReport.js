const mongoose = require("mongoose");
/** Crop damage recorded with photos, so there is real evidence for an insurer or an officer. */
const DamageReportSchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    cropType: { type: String, required: true },
    cause: { type: String, enum: ["drought", "flood", "heavy_rain", "pest", "disease", "wildlife", "fire", "other"], required: true },
    acresAffected: { type: Number, required: true, min: 0.01 },
    estimatedLossLkr: { type: Number, default: 0 },
    happenedOn: { type: Date, required: true },
    description: { type: String, default: "", maxlength: 400 },
    photoCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);
DamageReportSchema.index({ farmer: 1, createdAt: -1 });
module.exports = mongoose.model("DamageReport", DamageReportSchema);
