const mongoose = require("mongoose");

const MilestoneSchema = new mongoose.Schema(
  {
    day: { type: Number, required: true }, // day index from planting
    title: { type: String, required: true },
    description: { type: String },
    isCompleted: { type: Boolean, default: false },
    completedAt: { type: Date },
    weatherAlertTriggered: { type: Boolean, default: false },
  },
  { _id: false }
);

const CultivationTimelineSchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    cropType: { type: String, required: true },
    landSizeAcres: { type: Number, required: true },
    soilType: { type: String, required: true },
    gpsLocation: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    plantingDate: { type: Date, required: true },
    expectedHarvestDate: { type: Date, required: true },
    milestones: { type: [MilestoneSchema], default: [] },
    status: {
      type: String,
      enum: ["active", "completed", "abandoned"],
      default: "active",
    },
    // ---- OFFLINE-FIRST SYNC METADATA ----
    localId: { type: String, index: true }, // client-generated UUID from SQLite/Hive
    deviceId: { type: String }, // which device created/edited this record
    syncStatus: {
      type: String,
      enum: ["synced", "pending", "conflict"],
      default: "synced",
    },
    lastLocalModifiedAt: { type: Date }, // timestamp set on-device before sync
    lastSyncedAt: { type: Date },
  },
  { timestamps: true }
);

CultivationTimelineSchema.index({ gpsLocation: "2dsphere" });
CultivationTimelineSchema.index({ farmer: 1, status: 1 });
CultivationTimelineSchema.index({ localId: 1, farmer: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("CultivationTimeline", CultivationTimelineSchema);
