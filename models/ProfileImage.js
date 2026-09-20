const mongoose = require("mongoose");

/** A user's profile picture. Kept in its own collection so user lookups stay small and fast. */
const ProfileImageSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    mime: { type: String, required: true },
    data: { type: Buffer, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProfileImage", ProfileImageSchema);
