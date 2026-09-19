const mongoose = require("mongoose");

/**
 * BUYER DEMAND BOARD
 *
 * The marketplace normally works one way: farmers list, buyers browse.
 * The Demand Board flips it: a buyer posts "I need 300 kg of carrots by
 * Friday, up to LKR 240/kg" and farmers respond with offers BEFORE they
 * harvest. It also gives farmers a live signal of what to plant.
 */
const OfferSchema = new mongoose.Schema({
  farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  quantityKg: { type: Number, required: true, min: 1 },
  pricePerKg: { type: Number, required: true, min: 1 },
  message: { type: String, trim: true, maxlength: 300, default: "" },
  status: { type: String, enum: ["offered", "accepted", "declined", "withdrawn"], default: "offered" },
  acceptedKg: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

const DemandRequestSchema = new mongoose.Schema(
  {
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    cropType: { type: String, required: true, trim: true },
    quantityKg: { type: Number, required: true, min: 1 },
    maxPricePerKg: { type: Number, required: true, min: 1 },
    neededBy: { type: Date, required: true },
    // Optional: where the produce should be delivered. Empty = anywhere in Sri Lanka.
    district: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, maxlength: 300, default: "" },
    status: { type: String, enum: ["open", "fulfilled", "cancelled", "expired"], default: "open" },
    fulfilledKg: { type: Number, default: 0, min: 0 },
    offers: { type: [OfferSchema], default: [] },
    // Optimistic-lock counter. Every change to the offers goes through
    // "write only if revision is still what I read", then bumps it by 1 —
    // so two people acting at the same instant can never overwrite each other.
    revision: { type: Number, default: 0 },
  },
  { timestamps: true }
);

DemandRequestSchema.index({ status: 1, cropType: 1, district: 1 });
DemandRequestSchema.index({ buyer: 1, createdAt: -1 });
DemandRequestSchema.index({ "offers.farmer": 1 });

module.exports = mongoose.model("DemandRequest", DemandRequestSchema);
