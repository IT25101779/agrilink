const mongoose = require("mongoose");

/** One line in a farmer's own money book: a cost or an income. */
const LedgerEntrySchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    cropType: { type: String, default: "General" },
    type: { type: String, enum: ["expense", "income"], required: true },
    category: { type: String, enum: ["seeds", "fertilizer", "pesticide", "labour", "water", "transport", "equipment", "other", "sale"], default: "other" },
    amountLkr: { type: Number, required: true, min: 1 },
    note: { type: String, default: "", maxlength: 120 },
    date: { type: Date, required: true },
    clientId: { type: String, default: "" }, // lets a phone retry a save safely after being offline
    orderRef: { type: mongoose.Schema.Types.ObjectId, ref: "TradeOrder" }, // set when an AgriLink sale wrote this line
  },
  { timestamps: true }
);

LedgerEntrySchema.index({ farmer: 1, date: -1 });

module.exports = mongoose.model("LedgerEntry", LedgerEntrySchema);
