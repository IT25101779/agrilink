const express = require("express");
const router = express.Router();
const {
  createCampaign,
  getCampaigns,
  getMyCampaigns,
  getMyInvestments,
  pledgeToCampaign,
  repayCampaign,
} = require("../controllers/crowdfundingController");

router.post("/campaigns", createCampaign);
router.get("/campaigns", getCampaigns);
router.get("/campaigns/mine", getMyCampaigns);
router.get("/investments", getMyInvestments);
router.post("/campaigns/:id/pledge", pledgeToCampaign);
router.patch("/campaigns/:id/repay", repayCampaign);

module.exports = router;
