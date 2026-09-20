const mongoose = require("mongoose");
/** How a farmer wants to be paid: instructions text (they choose what to write) and optionally a bank-app QR photo. */
const PaymentProfileSchema = new mongoose.Schema(
  { user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true }, instructions: { type: String, default: "", maxlength: 200 }, hasQr: { type: Boolean, default: false } },
  { timestamps: true }
);
module.exports = mongoose.model("PaymentProfile", PaymentProfileSchema);
