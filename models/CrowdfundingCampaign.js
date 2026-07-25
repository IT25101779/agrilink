const mongoose = require("mongoose");

const PledgeSchema = new mongoose.Schema(
  {
    investor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    amountLkr: { type: Number, required: true },
    expectedReturnLkr: { type: Number, required: true },
    pledgedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ["pledged", "repaid"],
      default: "pledged",
    },
  },
  { _id: true }
);

const CrowdfundingCampaignSchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Stored as a plain string (the timeline's local/offline ID) rather than
    // a strict ObjectId ref, since the /timelines/sync-queue endpoint that
    // would create a matching CultivationTimeline document server-side is
    // still on the roadmap — this keeps crowdfunding usable today without
    // being blocked on that. Swap to a real ref once sync is built.
    timelineRef: { type: String, required: true },
    cropType: { type: String, required: true },
    description: { type: String, required: true },
    fundingGoalLkr: { type: Number, required: true },
    amountRaisedLkr: { type: Number, default: 0 },
    returnPercentage: { type: Number, required: true, min: 0, max: 100 }, // return offered to investors on success
    deadline: { type: Date, required: true },
    status: {
      type: String,
      enum: ["open", "funded", "repaid", "failed", "cancelled"],
      default: "open",
    },
    pledges: { type: [PledgeSchema], default: [] },
  },
  { timestamps: true }
);

CrowdfundingCampaignSchema.index({ status: 1, cropType: 1 });
CrowdfundingCampaignSchema.index({ farmer: 1 });

module.exports = mongoose.model("CrowdfundingCampaign", CrowdfundingCampaignSchema);
