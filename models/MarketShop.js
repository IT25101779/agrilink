const mongoose = require("mongoose");

/**
 * A real/demo wholesale shop at a market hub (e.g. shop No. 166 at the
 * Kandy market). Farmers pick one of these when booking lorry space so they
 * know exactly where their crop is going and who to call.
 */
const MarketShopSchema = new mongoose.Schema(
  {
    market: {
      type: String,
      enum: ["Dambulla", "Colombo_Manning_Market", "Pettah", "Kandy", "Jaffna", "Other"],
      required: true,
    },
    shopNumber: { type: String, required: true }, // kept as a string so "No. 166" style numbers display naturally
    name: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, default: "" },
    dealsIn: { type: [String], default: [] }, // crop types this shop mainly buys, for display only
    isFeatured: { type: Boolean, default: false }, // the market's "most chosen" / recommended shop
    isDemo: { type: Boolean, default: true }, // true until the farmer's own real shop list replaces it
    createdByAdmin: { type: Boolean, default: false },
  },
  { timestamps: true }
);

MarketShopSchema.index({ market: 1, shopNumber: 1 }, { unique: true });

module.exports = mongoose.model("MarketShop", MarketShopSchema);
