const mongoose = require("mongoose");

/**
 * FORWARD / CONTRACT LISTING
 *
 * The normal marketplace only sells what has ALREADY been harvested. This
 * flips it the other way, like the Buyer Demand Board but with a locked
 * price and a future delivery date: a buyer commits "I will buy 500kg of
 * Carrot in 60 days at LKR 230/kg, who's planting now?" — so a farmer can
 * decide what to plant with a price already agreed, instead of guessing.
 *
 * Same phone-first, no-online-payment pattern as everywhere else in the
 * app (see crowdfundingController.js): a farmer first just expresses
 * INTEREST (status "interested"), gets the buyer's phone number, they
 * discuss over the phone, and only a manual CONFIRM afterwards actually
 * locks the commitment in. There is no automatic online booking and no
 * in-app payment anywhere in this flow.
 */
const CommitmentSchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    quantityKg: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["interested", "confirmed", "delivered", "cancelled"], default: "interested" },
    createdAt: { type: Date, default: Date.now },
    confirmedAt: { type: Date },
  },
  { timestamps: false }
);

const ForwardContractSchema = new mongoose.Schema(
  {
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    cropType: { type: String, required: true, trim: true },
    totalQuantityKg: { type: Number, required: true, min: 1 },
    lockedPricePerKg: { type: Number, required: true, min: 1 },
    deliverByDate: { type: Date, required: true },
    // Optional: where the crop should be grown/delivered from. Empty = anywhere.
    district: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, maxlength: 300, default: "" },
    status: { type: String, enum: ["open", "fulfilled", "cancelled", "expired"], default: "open" },
    // Only CONFIRMED commitments count toward this (mirrors DemandRequest.fulfilledKg).
    committedKg: { type: Number, default: 0, min: 0 },
    commitments: { type: [CommitmentSchema], default: [] },
    // Optimistic-lock counter, same pattern as DemandRequest: write only if
    // this still matches what was last read, so two confirms at the same
    // instant can never both double-count the same remaining quantity.
    revision: { type: Number, default: 0 },
  },
  { timestamps: true }
);

ForwardContractSchema.index({ status: 1, cropType: 1, district: 1 });
ForwardContractSchema.index({ buyer: 1, createdAt: -1 });
ForwardContractSchema.index({ "commitments.farmer": 1 });

module.exports = mongoose.model("ForwardContract", ForwardContractSchema);
