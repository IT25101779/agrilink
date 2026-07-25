const mongoose = require("mongoose");

const ReminderSchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Local (offline) timeline ID, same pattern as CrowdfundingCampaign —
    // see that model's comment for why this isn't a strict ObjectId ref yet.
    timelineRef: { type: String, required: true },
    cropType: { type: String, required: true },
    type: {
      type: String,
      enum: ["weather_action", "disease_risk", "harvest_ready", "milestone_due"],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    requiresPhoto: { type: Boolean, default: false },
    relatedMilestoneDay: { type: Number },
    status: {
      type: String,
      enum: ["pending", "acknowledged", "dismissed", "photo_submitted"],
      default: "pending",
    },
    linkedDiseaseLogId: { type: mongoose.Schema.Types.ObjectId, ref: "DiseaseLog" },
    // Dedupe key so the reminder generator doesn't spam the same alert
    // every time it runs (e.g. every app open).
    dedupeKey: { type: String, required: true },
  },
  { timestamps: true }
);

ReminderSchema.index({ farmer: 1, status: 1, createdAt: -1 });
ReminderSchema.index({ dedupeKey: 1, farmer: 1 }, { unique: true });

module.exports = mongoose.model("Reminder", ReminderSchema);
