const mongoose = require("mongoose");

/** "Tell me when Tomato goes above LKR 200/kg." */
const PriceAlertSchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    cropType: { type: String, required: true },
    direction: { type: String, enum: ["above", "below"], required: true },
    thresholdLkr: { type: Number, required: true, min: 1 },
    market: { type: String, default: "" }, // empty = any market
    lastTriggeredDay: { type: String, default: "" },
  },
  { timestamps: true }
);

PriceAlertSchema.index({ farmer: 1 });
PriceAlertSchema.index({ cropType: 1 });

module.exports = mongoose.model("PriceAlert", PriceAlertSchema);
