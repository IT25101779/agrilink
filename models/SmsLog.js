const mongoose = require("mongoose");
const SmsLogSchema = new mongoose.Schema({ user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, kind: { type: String, default: "" }, status: { type: String, enum: ["sent", "failed", "skipped"], required: true }, month: { type: String, required: true }, detail: { type: String, default: "" } }, { timestamps: true });
SmsLogSchema.index({ user: 1, month: 1, status: 1 });
module.exports = mongoose.model("SmsLog", SmsLogSchema);
