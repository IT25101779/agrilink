const mongoose = require("mongoose");

/**
 * One row per completed, money-relevant event on the platform (a marketplace
 * sale, a confirmed crowdfunding pledge, a delivered lorry booking) so the
 * admin "profit" dashboard can add these up instead of guessing. Nothing
 * here moves real money — it's bookkeeping for the 5% commission / flat-fee
 * rule (see utils/commission.js) on deals that happened by phone/in person.
 */
const PlatformCommissionLogSchema = new mongoose.Schema(
  {
    source: { type: String, enum: ["marketplace_sale", "crowdfunding_pledge", "logistics_booking", "forward_contract"], required: true },
    refId: { type: mongoose.Schema.Types.ObjectId, required: true }, // the listing / campaign / lorry this came from
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    amountLkr: { type: Number, required: true },
    commissionLkr: { type: Number, required: true },
    feeType: { type: String, enum: ["commission", "flat_fee"], required: true },
  },
  { timestamps: true }
);

PlatformCommissionLogSchema.index({ source: 1, createdAt: -1 });

module.exports = mongoose.model("PlatformCommissionLog", PlatformCommissionLogSchema);
