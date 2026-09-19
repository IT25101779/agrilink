const mongoose = require("mongoose");
const CrowdfundingCampaign = require("../models/CrowdfundingCampaign");
const User = require("../models/User");

/**
 * IMPORTANT DEMO-SCOPE NOTE: this module simulates the funding ledger
 * (raising, pledging, repayment amounts) entirely within MongoDB. No real
 * payment gateway is integrated. Before any real money handling, this would
 * need a licensed payment processor (e.g. PayHere for LKR) and regulatory
 * review — crowdfunding/lending is a regulated financial activity in most
 * jurisdictions, including Sri Lanka.
 */

const MAX_PLEDGE_RETRIES = 3;

function isValidId(id) {
  return typeof id === "string" && mongoose.isValidObjectId(id);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * POST /api/crowdfunding/campaigns
 * Farmer requests funding for an active cultivation timeline.
 */
async function createCampaign(req, res) {
  try {
    const { farmer, timelineRef, cropType, description, fundingGoalLkr, returnPercentage, deadline } = req.body;

    if (!farmer || !timelineRef || !cropType || !description || !fundingGoalLkr || returnPercentage === undefined || !deadline) {
      return res.status(400).json({
        success: false,
        message: "farmer, timelineRef, cropType, description, fundingGoalLkr, returnPercentage, and deadline are required.",
      });
    }
    if (!isValidId(String(farmer))) {
      return res.status(400).json({ success: false, message: "farmer is not a valid user id." });
    }

    const goal = Number(fundingGoalLkr);
    const returnPct = Number(returnPercentage);
    if (!Number.isFinite(goal) || goal <= 0) {
      return res.status(400).json({ success: false, message: "fundingGoalLkr must be a positive number." });
    }
    if (!Number.isFinite(returnPct) || returnPct < 0 || returnPct > 100) {
      return res.status(400).json({ success: false, message: "returnPercentage must be between 0 and 100." });
    }
    const deadlineDate = new Date(deadline);
    if (Number.isNaN(deadlineDate.getTime()) || deadlineDate <= new Date()) {
      return res.status(400).json({ success: false, message: "The funding deadline (your expected harvest date) must be a valid date in the future." });
    }

    const campaign = await CrowdfundingCampaign.create({
      farmer,
      timelineRef,
      cropType,
      description,
      fundingGoalLkr: goal,
      returnPercentage: returnPct,
      deadline: deadlineDate,
      status: "open",
    });

    return res.status(201).json({ success: true, data: campaign });
  } catch (error) {
    console.error("createCampaign error:", error);
    return res.status(500).json({ success: false, message: "Failed to create campaign.", error: error.message });
  }
}

/**
 * GET /api/crowdfunding/campaigns?status=open&cropType=tomato
 * Public browse for investors.
 */
async function getCampaigns(req, res) {
  try {
    const { status, cropType } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (cropType) filter.cropType = cropType;

    const campaigns = await CrowdfundingCampaign.find(filter)
      .populate("farmer", "fullName farmerProfile.district farmerProfile.creditScore")
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: campaigns.length, data: campaigns });
  } catch (error) {
    console.error("getCampaigns error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch campaigns.", error: error.message });
  }
}

/**
 * GET /api/crowdfunding/campaigns/mine?farmerId=X
 */
async function getMyCampaigns(req, res) {
  try {
    const { farmerId } = req.query;
    if (!farmerId) {
      return res.status(400).json({ success: false, message: "farmerId is required." });
    }
    if (!isValidId(farmerId)) {
      return res.status(400).json({ success: false, message: "farmerId is not a valid id." });
    }
    const campaigns = await CrowdfundingCampaign.find({ farmer: farmerId })
      .populate("pledges.investor", "fullName")
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: campaigns });
  } catch (error) {
    console.error("getMyCampaigns error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch your campaigns.", error: error.message });
  }
}

/**
 * GET /api/crowdfunding/investments?investorId=X
 * All pledges a given investor has made, across every campaign.
 */
async function getMyInvestments(req, res) {
  try {
    const { investorId } = req.query;
    if (!investorId) {
      return res.status(400).json({ success: false, message: "investorId is required." });
    }
    if (!isValidId(investorId)) {
      return res.status(400).json({ success: false, message: "investorId is not a valid id." });
    }

    const campaigns = await CrowdfundingCampaign.find({ "pledges.investor": investorId })
      .populate("farmer", "fullName farmerProfile.district")
      .sort({ createdAt: -1 });

    const investments = campaigns.flatMap((c) =>
      c.pledges
        .filter((p) => p.investor.toString() === investorId)
        .map((p) => ({
          campaignId: c._id,
          cropType: c.cropType,
          farmerName: c.farmer?.fullName,
          campaignStatus: c.status,
          amountLkr: p.amountLkr,
          expectedReturnLkr: p.expectedReturnLkr,
          pledgeStatus: p.status,
          pledgedAt: p.pledgedAt,
        }))
    );

    return res.status(200).json({ success: true, data: investments });
  } catch (error) {
    console.error("getMyInvestments error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch your investments.", error: error.message });
  }
}

/**
 * POST /api/crowdfunding/campaigns/:id/pledge
 * An urban consumer/investor pledges an amount toward a farmer's campaign.
 * The pledge is capped at the amount still needed (no overfunding), and
 * reaching the goal flips status to "funded".
 *
 * RACE-CONDITION FIX: the old code read the campaign, did the maths in
 * memory, then saved. Two investors pledging at the same moment would both
 * read the same "amount raised" and the campaign could end up over its goal.
 * Now the write only succeeds if the amount raised is STILL the value we
 * read; if someone else pledged in between, we re-read and try again.
 */
async function pledgeToCampaign(req, res) {
  try {
    const { id } = req.params;
    const { investor, amountLkr } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid campaign id." });
    }
    const requested = Number(amountLkr);
    if (!investor || !isValidId(String(investor)) || !Number.isFinite(requested) || requested <= 0) {
      return res.status(400).json({ success: false, message: "A valid investor and a positive amountLkr are required." });
    }

    for (let attempt = 0; attempt < MAX_PLEDGE_RETRIES; attempt++) {
      const campaign = await CrowdfundingCampaign.findById(id);
      if (!campaign) {
        return res.status(404).json({ success: false, message: "Campaign not found." });
      }
      if (campaign.farmer.toString() === String(investor)) {
        return res.status(403).json({ success: false, message: "You cannot invest in your own campaign." });
      }
      if (campaign.status !== "open") {
        return res.status(409).json({ success: false, message: `This campaign is no longer open (status: ${campaign.status}).` });
      }
      if (new Date(campaign.deadline) < new Date()) {
        await CrowdfundingCampaign.updateOne({ _id: id, status: "open" }, { $set: { status: "failed" } });
        return res.status(409).json({ success: false, message: "This campaign's funding deadline has passed." });
      }

      const remainingNeeded = round2(campaign.fundingGoalLkr - campaign.amountRaisedLkr);
      if (remainingNeeded <= 0) {
        return res.status(409).json({ success: false, message: "This campaign has already reached its goal." });
      }

      const actualPledgeAmount = round2(Math.min(requested, remainingNeeded));
      const expectedReturnLkr = round2(actualPledgeAmount * (1 + campaign.returnPercentage / 100));
      const newAmountRaised = round2(campaign.amountRaisedLkr + actualPledgeAmount);
      const reachesGoal = newAmountRaised >= campaign.fundingGoalLkr;

      const updated = await CrowdfundingCampaign.findOneAndUpdate(
        { _id: id, status: "open", amountRaisedLkr: campaign.amountRaisedLkr },
        {
          $push: { pledges: { investor, amountLkr: actualPledgeAmount, expectedReturnLkr, status: "pledged" } },
          $set: { amountRaisedLkr: newAmountRaised, status: reachesGoal ? "funded" : "open" },
        },
        { new: true }
      );

      if (updated) {
        return res.status(200).json({
          success: true,
          message:
            actualPledgeAmount < requested
              ? `Campaign only needed LKR ${actualPledgeAmount} more to reach its goal — your pledge was capped accordingly.`
              : "Pledge successful.",
          data: updated,
        });
      }
      // Someone else pledged between our read and write — loop and re-read.
    }

    return res.status(409).json({
      success: false,
      message: "This campaign is receiving many pledges right now. Please try again.",
    });
  } catch (error) {
    console.error("pledgeToCampaign error:", error);
    return res.status(500).json({ success: false, message: "Failed to process pledge.", error: error.message });
  }
}

/**
 * PATCH /api/crowdfunding/campaigns/:id/repay
 * Called once the farmer's harvest sells and they can repay investors.
 * Marks the campaign and all its pledges as repaid, and nudges the
 * farmer's alternative credit score upward.
 *
 * DOUBLE-REWARD FIX: the status change "funded" -> "repaid" is now a single
 * atomic operation, so two quick taps (or two devices) cannot both succeed
 * and award the credit-score bonus twice.
 */
async function repayCampaign(req, res) {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid campaign id." });
    }

    // Step 1: claim the "funded -> repaid" transition. Only ONE request can
    // win this, so the credit-score reward below can never be given twice.
    const claimed = await CrowdfundingCampaign.findOneAndUpdate(
      { _id: id, status: "funded" },
      { $set: { status: "repaid" } },
      { new: true }
    );

    if (!claimed) {
      const existing = await CrowdfundingCampaign.findById(id);
      if (!existing) {
        return res.status(404).json({ success: false, message: "Campaign not found." });
      }
      return res.status(409).json({ success: false, message: `Only fully-funded campaigns can be repaid (status: ${existing.status}).` });
    }

    // Step 2: mark every pledge as repaid.
    const repaidPledges = claimed.toObject().pledges.map((p) => ({ ...p, status: "repaid" }));
    const campaign = await CrowdfundingCampaign.findByIdAndUpdate(id, { $set: { pledges: repaidPledges } }, { new: true });

    // Step 3: reward successful repayment: +1 completed timeline, +25 credit
    // score, never above the 1000 ceiling.
    await User.updateOne(
      { _id: campaign.farmer },
      { $inc: { "farmerProfile.completedTimelinesCount": 1, "farmerProfile.creditScore": 25 } }
    );
    await User.updateOne({ _id: campaign.farmer, "farmerProfile.creditScore": { $gt: 1000 } }, { $set: { "farmerProfile.creditScore": 1000 } });

    const totalRepaidLkr = round2(campaign.pledges.reduce((sum, p) => sum + p.expectedReturnLkr, 0));

    return res.status(200).json({
      success: true,
      message: `Campaign repaid. Total LKR ${totalRepaidLkr} distributed across ${campaign.pledges.length} investor(s).`,
      data: campaign,
    });
  } catch (error) {
    console.error("repayCampaign error:", error);
    return res.status(500).json({ success: false, message: "Failed to repay campaign.", error: error.message });
  }
}

module.exports = { createCampaign, getCampaigns, getMyCampaigns, getMyInvestments, pledgeToCampaign, repayCampaign };
