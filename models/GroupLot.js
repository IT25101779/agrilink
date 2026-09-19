const mongoose = require("mongoose");

/**
 * GROUP SELLING ("collective lot")
 *
 * Hotels, supermarkets and exporters buy in bulk (hundreds of kg), but a
 * smallholder may only have 60-80 kg. A GroupLot lets neighbouring farmers
 * pool their harvest under one target quantity and one asking price. When
 * the lot is full a buyer can claim the whole thing in one go, and each
 * farmer's share of the money is proportional to the kg they contributed.
 *
 * (Payment itself is not handled by AgriLink in this version — the lot
 * records who contributed how much, and the buyer pays / collects.)
 */
const MemberSchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    quantityKg: { type: Number, required: true, min: 1 },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const GroupLotSchema = new mongoose.Schema(
  {
    cropType: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true },
    targetKg: { type: Number, required: true, min: 50 },
    pricePerKg: { type: Number, required: true, min: 1 },
    pickupNote: { type: String, trim: true, maxlength: 200, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    members: { type: [MemberSchema], default: [] },
    committedKg: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["open", "full", "claimed", "cancelled", "expired"],
      default: "open",
    },
    claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    claimedAt: { type: Date },
    closesAt: { type: Date, required: true },
  },
  { timestamps: true }
);

GroupLotSchema.index({ status: 1, district: 1, cropType: 1 });
GroupLotSchema.index({ "members.farmer": 1 });

module.exports = mongoose.model("GroupLot", GroupLotSchema);
