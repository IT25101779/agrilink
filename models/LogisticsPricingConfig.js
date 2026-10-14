const mongoose = require("mongoose");

/**
 * Single-document config for how much a lorry booking costs per kg.
 * Admin-editable ("from admin site can change price its for developers" —
 * the user's own words). Defaults match what was asked for at launch:
 * LKR 50/kg for the first 10kg, LKR 20/kg for every kg after that.
 * There is only ever one of these documents — look it up with findOne()
 * and create it if missing (see getOrCreate below).
 */
const LogisticsPricingConfigSchema = new mongoose.Schema(
  {
    tierThresholdKg: { type: Number, default: 10 },
    ratePerKgUnderThreshold: { type: Number, default: 50 },
    ratePerKgAtOrOverThreshold: { type: Number, default: 20 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

LogisticsPricingConfigSchema.statics.getOrCreate = async function () {
  let doc = await this.findOne();
  if (!doc) doc = await this.create({});
  return doc;
};

/** Tiered calculation: the first tierThresholdKg kg cost the higher rate,
 * every kg after that costs the lower rate. Matches: "charge 50 rupees per
 * kilo that total kilos under 10, other kilos will charge as 20 rupees per
 * kilo" — i.e. the first 10kg are the expensive small-load tier. */
LogisticsPricingConfigSchema.statics.calculateRent = function (config, weightKg) {
  const w = Math.max(0, Number(weightKg) || 0);
  const tier = config.tierThresholdKg;
  const underKg = Math.min(w, tier);
  const overKg = Math.max(0, w - tier);
  const rent = underKg * config.ratePerKgUnderThreshold + overKg * config.ratePerKgAtOrOverThreshold;
  return Math.round(rent);
};

module.exports = mongoose.model("LogisticsPricingConfig", LogisticsPricingConfigSchema);
