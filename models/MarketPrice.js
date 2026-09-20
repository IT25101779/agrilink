const mongoose = require("mongoose");

/** A wholesale price for one crop at one market on one day. */
const MarketPriceSchema = new mongoose.Schema(
  {
    cropType: { type: String, required: true },
    market: { type: String, enum: ["Dambulla", "Manning", "Pettah", "Kandy", "Jaffna", "Meegoda"], required: true },
    pricePerKg: { type: Number, required: true, min: 0.5, max: 10000 },
    day: { type: String, required: true }, // YYYY-MM-DD
    source: { type: String, enum: ["admin", "farmer"], default: "admin" },
    verified: { type: Boolean, default: false },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

MarketPriceSchema.index({ cropType: 1, market: 1, day: -1 });
MarketPriceSchema.index({ verified: 1, day: -1 });

module.exports = mongoose.model("MarketPrice", MarketPriceSchema);
