const mongoose = require("mongoose");
/** A small photo kept privately for a purpose: delivery proof, a dispute, storm/pest damage, or an ID check. */
const PhotoSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    purpose: { type: String, enum: ["order", "dispute", "damage", "verification", "payment_qr"], required: true },
    refId: { type: mongoose.Schema.Types.ObjectId }, // the order / dispute / damage report it belongs to
    label: { type: String, default: "", maxlength: 40 }, // e.g. "pickup", "delivery"
    mime: { type: String, required: true },
    data: { type: Buffer, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: true }
);
PhotoSchema.index({ purpose: 1, refId: 1 });
module.exports = mongoose.model("Photo", PhotoSchema);
