const mongoose = require("mongoose");
const RainfallCacheSchema = new mongoose.Schema({ district: { type: String, required: true, unique: true }, monthlyMm: { type: [Number], default: [] }, years: { type: Number, default: 0 }, fetchedAt: { type: Date, default: Date.now } });
module.exports = mongoose.model("RainfallCache", RainfallCacheSchema);
