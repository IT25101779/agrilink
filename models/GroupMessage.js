const mongoose = require("mongoose");

/**
 * One message in a group. The real sender is stored (so admins can act on
 * abuse) but is NEVER sent to other farmers — they only see the alias.
 */
const GroupMessageSchema = new mongoose.Schema(
  {
    groupKey: { type: String, required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // empty for system messages
    alias: { type: String, required: true },
    avatarHue: { type: Number, default: 0 },
    avatarEmoji: { type: String, default: "🌱" },
    type: { type: String, enum: ["text", "image", "voice", "scan", "system"], default: "text" },
    text: { type: String, default: "", maxlength: 1200 },
    mediaId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatMedia" },
    durationSec: { type: Number },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "GroupMessage" },
    replyPreview: { alias: String, text: String, kind: String },
    // Small structured extras: a shared disease scan, or an outbreak alert.
    attachment: { type: mongoose.Schema.Types.Mixed },
    helpfulBy: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    reportCount: { type: Number, default: 0 },
    status: { type: String, enum: ["visible", "hidden", "removed"], default: "visible" },
    removedReason: { type: String },
  },
  { timestamps: true }
);

GroupMessageSchema.index({ groupKey: 1, _id: -1 });
GroupMessageSchema.index({ sender: 1, createdAt: -1 });

module.exports = mongoose.model("GroupMessage", GroupMessageSchema);
