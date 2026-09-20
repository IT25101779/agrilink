const mongoose = require("mongoose");
/** "Elephants near the paddy field tonight" — neighbours get warned. Sightings expire after 48 hours. */
const WildlifeSightingSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    species: { type: String, enum: ["elephant", "wild_boar", "monkey", "peacock", "porcupine", "other"], required: true },
    location: { type: { type: String, enum: ["Point"], default: "Point" }, coordinates: { type: [Number], required: true } },
    district: { type: String, default: "" },
    note: { type: String, default: "", maxlength: 160 },
    confirmedBy: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    allClearBy: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    clientId: { type: String, default: "" },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);
WildlifeSightingSchema.index({ location: "2dsphere" });
WildlifeSightingSchema.index({ expiresAt: 1 });
module.exports = mongoose.model("WildlifeSighting", WildlifeSightingSchema);
