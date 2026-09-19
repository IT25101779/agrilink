const mongoose = require("mongoose");

/**
 * Photo or voice note bytes. Kept in their OWN collection so listing
 * messages never drags the (large) bytes along with it.
 */
const ChatMediaSchema = new mongoose.Schema(
  {
    groupKey: { type: String, required: true },
    uploader: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["image", "voice"], required: true },
    mime: { type: String, required: true },
    data: { type: Buffer, required: true },
    size: { type: Number, required: true },
    durationSec: { type: Number },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ChatMedia", ChatMediaSchema);
