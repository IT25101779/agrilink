const express = require("express");
const { protect, requireRole } = require("../middleware/authMiddleware");
const { bindIdentity, ownerOf } = require("../middleware/identity");
const CrowdfundingCampaign = require("../models/CrowdfundingCampaign");
const router = express.Router();
const {
  createCampaign,
  getCampaigns,
  getMyCampaigns,
  getMyInvestments,
  pledgeToCampaign,
  repayCampaign,
} = require("../controllers/crowdfundingController");

router.use(protect, bindIdentity);
router.post("/campaigns", requireRole("farmer"), createCampaign);
router.get("/campaigns", getCampaigns);
router.get("/campaigns/mine", getMyCampaigns);
router.get("/investments", getMyInvestments);
router.post("/campaigns/:id/pledge", pledgeToCampaign);
router.patch("/campaigns/:id/repay", ownerOf(CrowdfundingCampaign, "farmer"), repayCampaign);

module.exports = router;
