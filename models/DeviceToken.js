const mongoose = require("mongoose");
const DeviceTokenSchema = new mongoose.Schema({ user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, token: { type: String, required: true }, platform: { type: String, default: "android" } }, { timestamps: true });
DeviceTokenSchema.index({ token: 1 }, { unique: true });
DeviceTokenSchema.index({ user: 1 });
module.exports = mongoose.model("DeviceToken", DeviceTokenSchema);
