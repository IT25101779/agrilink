const mongoose = require("mongoose");
/** How much a field produced — the base for "kg per acre" and comparing with neighbours. */
const YieldRecordSchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    cropType: { type: String, required: true },
    season: { type: String, enum: ["yala", "maha", "other"], required: true },
    year: { type: Number, required: true },
    acres: { type: Number, required: true, min: 0.01 },
    harvestKg: { type: Number, required: true, min: 1 },
    district: { type: String, default: "" },
    note: { type: String, default: "", maxlength: 120 },
    clientId: { type: String, default: "" },
  },
  { timestamps: true }
);
YieldRecordSchema.index({ farmer: 1, year: -1 });
YieldRecordSchema.index({ cropType: 1, district: 1, year: -1 });
module.exports = mongoose.model("YieldRecord", YieldRecordSchema);
