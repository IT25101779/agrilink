const mongoose = require("mongoose");
/** Server errors and slow requests, kept for 14 days so problems are noticed before farmers report them. */
const ErrorLogSchema = new mongoose.Schema(
  { method: String, path: String, status: Number, ms: Number, message: { type: String, default: "" }, kind: { type: String, enum: ["error", "slow"], default: "error" }, at: { type: Date, default: Date.now } },
  {}
);
ErrorLogSchema.index({ at: 1 }, { expireAfterSeconds: 14 * 24 * 3600 });
module.exports = mongoose.model("ErrorLog", ErrorLogSchema);
