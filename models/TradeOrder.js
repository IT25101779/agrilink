const mongoose = require("mongoose");

/**
 * One whole-lot order from a buyer for a farmer's listing, from "placed" to
 * "paid". Delivery is proven with a 4-digit code the BUYER holds and the
 * delivering side must type in.
 */
const TradeOrderSchema = new mongoose.Schema(
  {
    listing: { type: mongoose.Schema.Types.ObjectId, ref: "MarketplaceListing", required: true },
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    cropType: { type: String, required: true },
    quantityKg: { type: Number, required: true },
    pricePerKg: { type: Number, required: true },
    totalLkr: { type: Number, required: true },
    status: { type: String, enum: ["placed", "accepted", "dispatched", "delivered", "paid", "cancelled"], default: "placed" },
    delivery: {
      method: { type: String, enum: ["truck", "self", "pickup"] },
      returnTrip: { type: mongoose.Schema.Types.ObjectId, ref: "ReturnTrip" },
      dispatchedAt: { type: Date },
      deliveredAt: { type: Date },
      codeSalt: { type: String, select: false },
      codeAttempts: { type: Number, default: 0 },
    },
    payment: {
      method: { type: String, enum: ["cash", "bank_transfer", "mobile_wallet"] },
      buyerMarkedAt: { type: Date },
      farmerConfirmedAt: { type: Date },
    },
    cancelledBy: { type: String, enum: ["farmer", "buyer"] },
    cancelReason: { type: String, maxlength: 200 },
    events: { type: [{ status: String, by: String, at: { type: Date, default: Date.now } }], default: [] },
  },
  { timestamps: true }
);

TradeOrderSchema.index({ farmer: 1, createdAt: -1 });
TradeOrderSchema.index({ buyer: 1, createdAt: -1 });

module.exports = mongoose.model("TradeOrder", TradeOrderSchema);
