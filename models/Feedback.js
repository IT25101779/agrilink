const mongoose = require("mongoose");
const FeedbackSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["bug", "idea", "praise", "help"], default: "idea" },
    message: { type: String, required: true, maxlength: 600 },
    screen: { type: String, default: "", maxlength: 60 },
    appVersion: { type: String, default: "", maxlength: 20 },
    clientId: { type: String, default: "" },
    status: { type: String, enum: ["new", "seen", "done"], default: "new" },
  },
  { timestamps: true }
);
FeedbackSchema.index({ status: 1, createdAt: -1 });
FeedbackSchema.index({ user: 1, clientId: 1 });
module.exports = mongoose.model("Feedback", FeedbackSchema);
