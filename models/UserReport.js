const mongoose = require("mongoose");
/** Anyone can report a person they dealt with (order, truck trip...). Admins review. */
const UserReportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reported: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    context: { type: String, enum: ["order", "trip", "listing", "other"], default: "other" },
    contextId: { type: String, default: "" },
    reason: { type: String, enum: ["scam", "abuse", "fake_listing", "no_show", "unsafe", "other"], required: true },
    note: { type: String, default: "", maxlength: 300 },
    status: { type: String, enum: ["open", "reviewed", "actioned"], default: "open" },
  },
  { timestamps: true }
);
UserReportSchema.index({ status: 1, createdAt: -1 });
UserReportSchema.index({ reported: 1 });
module.exports = mongoose.model("UserReport", UserReportSchema);
