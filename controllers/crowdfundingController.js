const mongoose = require("mongoose");
const CrowdfundingCampaign = require("../models/CrowdfundingCampaign");
const User = require("../models/User");
const { notifyFarmer } = require("../utils/notify");
const { PLATFORM_COMMISSION_RATE, NO_COMMISSION_BELOW_LKR, calculateCommission } = require("../utils/commission");

/**
 * IMPORTANT DEMO-SCOPE NOTE: this module simulates the funding ledger
 * (raising, pledging, repayment amounts) entirely within MongoDB. No real
 * payment gateway is integrated. Before any real money handling, this would
 * need a licensed payment processor (e.g. PayHere for LKR) and regulatory
 * review — crowdfunding/lending is a regulated financial activity in most
 * jurisdictions, including Sri Lanka.
 *
 * FLOW REDESIGNED (Oct 2026) per a direct request: "don't make booking in
 * here — if an investor likes to invest, after adding details they can
 * discuss over the phone, then they can confirm through the system; if
 * they confirmed it through the system they will get benefits."
 *
 * So pledging is now two steps, not one:
 *   1. pledgeToCampaign — investor expresses INTEREST only. Nothing is
 *      counted toward the funding goal yet. The farmer's phone number is
 *      returned immediately so they can call and discuss first.
 *   2. confirmPledge — AFTER that phone call, either side confirms through
 *      the app. Only then does the amount count toward the campaign's
 *      goal, and only a confirmed pledge earns the investor "benefits"
 *      (and the platform its small commission on a successful raise).
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
      .populate("farmer", "fullName phone farmerProfile.district")
      .sort({ createdAt: -1 });

    const investments = campaigns.flatMap((c) =>
      c.pledges
        .filter((p) => p.investor.toString() === investorId)
        .map((p) => ({
          campaignId: c._id,
          pledgeId: p._id, // needed to call PATCH /campaigns/:id/pledges/:pledgeId/confirm
          cropType: c.cropType,
          farmerName: c.farmer?.fullName,
          farmerPhone: c.farmer?.phone,
          campaignStatus: c.status,
          amountLkr: p.amountLkr,
          expectedReturnLkr: p.expectedReturnLkr,
          pledgeStatus: p.status, // "interested" | "pledged" | "repaid"
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
 * STEP 1 of 2: an investor expresses INTEREST in a campaign — no money
 * (real or simulated) moves yet, and nothing counts toward the funding
 * goal. The farmer's phone number comes back immediately so the investor
 * can call and discuss the details first, exactly as asked.
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

    const campaign = await CrowdfundingCampaign.findById(id).populate("farmer", "fullName phone");
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found." });
    }
    if (campaign.farmer._id.toString() === String(investor)) {
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

    const intendedAmount = round2(Math.min(requested, remainingNeeded));
    const expectedReturnLkr = round2(intendedAmount * (1 + campaign.returnPercentage / 100));

    const updated = await CrowdfundingCampaign.findByIdAndUpdate(
      id,
      { $push: { pledges: { investor, amountLkr: intendedAmount, expectedReturnLkr, status: "interested" } } },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: "Interest recorded. Call the farmer to discuss, then confirm through the app to make it count.",
      farmerPhone: campaign.farmer.phone,
      farmerName: campaign.farmer.fullName,
      data: updated,
    });
  } catch (error) {
    console.error("pledgeToCampaign error:", error);
    return res.status(500).json({ success: false, message: "Failed to record interest.", error: error.message });
  }
}

/**
 * PATCH /api/crowdfunding/campaigns/:id/pledges/:pledgeId/confirm
 * STEP 2 of 2: AFTER the phone call, either the investor or the farmer
 * confirms through the app that the deal is real. Only now does the
 * amount count toward the funding goal, the investor earns "benefits"
 * (their expected return becomes real once repaid), and the platform logs
 * its small commission/fee on the raise.
 *
 * Kept as a retry loop (like the old single-step pledge was) because two
 * confirms landing at once could still overfund the campaign.
 */
async function confirmPledge(req, res) {
  try {
    const { id, pledgeId } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid campaign id." });
    }

    for (let attempt = 0; attempt < MAX_PLEDGE_RETRIES; attempt++) {
      const campaign = await CrowdfundingCampaign.findById(id);
      if (!campaign) {
        return res.status(404).json({ success: false, message: "Campaign not found." });
      }
      const pledge = campaign.pledges.id(pledgeId);
      if (!pledge) {
        return res.status(404).json({ success: false, message: "Pledge not found." });
      }
      const isInvestor = String(pledge.investor) === String(req.userId);
      const isFarmer = String(campaign.farmer) === String(req.userId);
      if (!isInvestor && !isFarmer) {
        return res.status(403).json({ success: false, message: "Only the investor or the farmer can confirm this." });
      }
      if (pledge.status !== "interested") {
        return res.status(409).json({ success: false, message: `This pledge is already ${pledge.status}.` });
      }
      if (campaign.status !== "open") {
        return res.status(409).json({ success: false, message: `This campaign is no longer open (status: ${campaign.status}).` });
      }

      const remainingNeeded = round2(campaign.fundingGoalLkr - campaign.amountRaisedLkr);
      if (remainingNeeded <= 0) {
        return res.status(409).json({ success: false, message: "This campaign has already reached its goal from other confirmed pledges." });
      }
      const actualAmount = round2(Math.min(pledge.amountLkr, remainingNeeded));
      const newAmountRaised = round2(campaign.amountRaisedLkr + actualAmount);
      const reachesGoal = newAmountRaised >= campaign.fundingGoalLkr;

      const updated = await CrowdfundingCampaign.findOneAndUpdate(
        { _id: id, "pledges._id": pledgeId, "pledges.status": "interested", amountRaisedLkr: campaign.amountRaisedLkr },
        {
          $set: {
            "pledges.$.status": "pledged",
            "pledges.$.amountLkr": actualAmount,
            amountRaisedLkr: newAmountRaised,
            status: reachesGoal ? "funded" : "open",
          },
        },
        { new: true }
      );

      if (updated) {
        await logCommission({ source: "crowdfunding_pledge", refId: updated._id, farmer: updated.farmer, amountLkr: actualAmount });
        return res.status(200).json({ success: true, message: "Pledge confirmed.", data: updated });
      }
      // Someone else confirmed/changed something between our read and write — loop and re-read.
    }

    return res.status(409).json({ success: false, message: "This campaign is receiving many confirmations right now. Please try again." });
  } catch (error) {
    console.error("confirmPledge error:", error);
    return res.status(500).json({ success: false, message: "Failed to confirm pledge.", error: error.message });
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

module.exports = { createCampaign, getCampaigns, getMyCampaigns, getMyInvestments, pledgeToCampaign, confirmPledge, repayCampaign };
