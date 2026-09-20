const mongoose = require("mongoose");
/** "I don't want to deal with this person." Checked when ordering or booking. */
const BlockSchema = new mongoose.Schema({ blocker: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, blocked: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true } }, { timestamps: true });
BlockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
module.exports = mongoose.model("Block", BlockSchema);
