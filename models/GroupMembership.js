const mongoose = require("mongoose");

/** A farmer's membership of one chat group, including their anonymous alias there. */
const GroupMembershipSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    groupKey: { type: String, required: true },
    alias: { type: String, required: true },
    avatarHue: { type: Number, default: 0 },
    avatarEmoji: { type: String, default: "🌱" },
    muted: { type: Boolean, default: false },
    blockedAliases: { type: [String], default: [] },
    lastReadAt: { type: Date, default: Date.now },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

GroupMembershipSchema.index({ user: 1, groupKey: 1 }, { unique: true });
GroupMembershipSchema.index({ groupKey: 1 });

module.exports = mongoose.model("GroupMembership", GroupMembershipSchema);
