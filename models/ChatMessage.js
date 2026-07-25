const mongoose = require("mongoose");

const ChatMessageSchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    language: { type: String, enum: ["si", "ta", "en"], default: "en" },
  },
  { timestamps: true }
);

ChatMessageSchema.index({ farmer: 1, createdAt: 1 });

module.exports = mongoose.model("ChatMessage", ChatMessageSchema);
