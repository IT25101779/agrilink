const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  getPlantingSignals,
  getPriceForecast,
  getSellOrHold,
  generatePriceAlerts,
  getProfitPlan,
} = require("../controllers/insightsController");

// Every insights route needs a logged-in user; identity comes from the
// verified login token (req.userId), never from the request body.
router.get("/planting-signals", protect, getPlantingSignals);
router.get("/price-forecast/:cropType", protect, getPriceForecast);
router.get("/sell-or-hold", protect, getSellOrHold);
router.get("/profit-plan/:cropType", protect, getProfitPlan);
router.post("/price-alerts/generate", protect, generatePriceAlerts);

module.exports = router;
