const mongoose = require("mongoose");
/** A government guaranteed / support price the admin publishes (e.g. for paddy). The admin types the official figure. */
const SupportPriceSchema = new mongoose.Schema(
  {
    cropType: { type: String, required: true },
    label: { type: String, default: "", maxlength: 60 },
    pricePerKg: { type: Number, required: true, min: 1 },
    source: { type: String, default: "", maxlength: 120 },
    effectiveFrom: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
SupportPriceSchema.index({ cropType: 1, effectiveFrom: -1 });
module.exports = mongoose.model("SupportPrice", SupportPriceSchema);
