const mongoose = require("mongoose");
const DisputeSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "TradeOrder", required: true },
    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    against: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, enum: ["quality", "quantity", "not_delivered", "not_paid", "wrong_price", "other"], required: true },
    description: { type: String, default: "", maxlength: 500 },
    status: { type: String, enum: ["open", "resolved", "dismissed"], default: "open" },
    messages: { type: [{ by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, role: String, text: { type: String, maxlength: 400 }, at: { type: Date, default: Date.now } }], default: [] },
    resolution: { type: String, default: "", maxlength: 500 },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);
DisputeSchema.index({ order: 1 });
DisputeSchema.index({ status: 1, createdAt: -1 });
module.exports = mongoose.model("Dispute", DisputeSchema);
