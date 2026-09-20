const mongoose = require("mongoose");
/** A farmer's question for an agriculture officer of their district. */
const QuestionSchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    district: { type: String, required: true },
    cropType: { type: String, default: "General" },
    text: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: ["open", "answered"], default: "open" },
    answer: { type: String, default: "", maxlength: 800 },
    answeredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    answeredAt: { type: Date },
  },
  { timestamps: true }
);
QuestionSchema.index({ district: 1, status: 1, createdAt: -1 });
QuestionSchema.index({ farmer: 1, createdAt: -1 });
module.exports = mongoose.model("Question", QuestionSchema);
