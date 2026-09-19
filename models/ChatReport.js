const mongoose = require("mongoose");

/** A farmer's report of a message. One report per farmer per message. */
const ChatReportSchema = new mongoose.Schema(
  {
    message: { type: mongoose.Schema.Types.ObjectId, ref: "GroupMessage", required: true },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, enum: ["abuse", "spam", "personal_info", "unsafe_image", "other"], default: "other" },
    status: { type: String, enum: ["open", "dismissed", "actioned"], default: "open" },
  },
  { timestamps: true }
);

ChatReportSchema.index({ message: 1, reporter: 1 }, { unique: true });
ChatReportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("ChatReport", ChatReportSchema);
