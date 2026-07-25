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

    const campaign = await CrowdfundingCampaign.create({
      farmer,
      timelineRef,
      cropType,
      description,
      fundingGoalLkr,
      returnPercentage,
      deadline,
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
 * Pledge is automatically capped at the remaining amount needed to hit the
 * goal (no overfunding). Reaching the goal flips status to "funded".
 */
async function pledgeToCampaign(req, res) {
  try {
    const { id } = req.params;
    const { investor, amountLkr } = req.body;

    if (!investor || !amountLkr || amountLkr <= 0) {
      return res.status(400).json({ success: false, message: "investor and a positive amountLkr are required." });
    }

    const campaign = await CrowdfundingCampaign.findById(id);
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found." });
    }
    if (campaign.status !== "open") {
      return res.status(409).json({ success: false, message: `This campaign is no longer open (status: ${campaign.status}).` });
    }
    if (new Date(campaign.deadline) < new Date()) {
      campaign.status = "failed";
      await campaign.save();
      return res.status(409).json({ success: false, message: "This campaign's funding deadline has passed." });
    }

    const remainingNeeded = campaign.fundingGoalLkr - campaign.amountRaisedLkr;
    const actualPledgeAmount = Math.min(amountLkr, remainingNeeded);
    const expectedReturnLkr = Math.round(actualPledgeAmount * (1 + campaign.returnPercentage / 100) * 100) / 100;

    campaign.pledges.push({
      investor,
      amountLkr: actualPledgeAmount,
      expectedReturnLkr,
      status: "pledged",
    });
    campaign.amountRaisedLkr += actualPledgeAmount;

    if (campaign.amountRaisedLkr >= campaign.fundingGoalLkr) {
      campaign.status = "funded";
    }

    await campaign.save();

    return res.status(200).json({
      success: true,
      message:
        actualPledgeAmount < amountLkr
          ? `Campaign only needed LKR ${actualPledgeAmount} more to reach its goal — your pledge was capped accordingly.`
          : "Pledge successful.",
      data: campaign,
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
 * farmer's alternative credit score upward for a successfully completed
 * funding cycle — this feeds the "unlock micro-loans" credit system.
 */
async function repayCampaign(req, res) {
  try {
    const { id } = req.params;

    const campaign = await CrowdfundingCampaign.findById(id);
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found." });
    }
    if (campaign.status !== "funded") {
      return res.status(409).json({ success: false, message: `Only fully-funded campaigns can be repaid (status: ${campaign.status}).` });
    }

    campaign.pledges.forEach((p) => {
      p.status = "repaid";
    });
    campaign.status = "repaid";
    await campaign.save();

    // Reward successful repayment: +1 completed timeline, +25 credit score (capped at 1000).
    // This feeds the "alternative credit scoring" system used to unlock micro-loans.
    await User.findByIdAndUpdate(campaign.farmer, [
      {
        $set: {
          "farmerProfile.completedTimelinesCount": { $add: [{ $ifNull: ["$farmerProfile.completedTimelinesCount", 0] }, 1] },
          "farmerProfile.creditScore": {
            $min: [{ $add: [{ $ifNull: ["$farmerProfile.creditScore", 500] }, 25] }, 1000],
          },
        },
      },
    ]);

    const totalRepaidLkr = campaign.pledges.reduce((sum, p) => sum + p.expectedReturnLkr, 0);

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
