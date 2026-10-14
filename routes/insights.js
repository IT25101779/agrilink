const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  getPlantingSignals,
  getPriceForecast,
  getSellOrHold,
  generatePriceAlerts,
  getProfitPlan,
  getNextSeasonAdvisor,
  getBenchmark,
} = require("../controllers/insightsController");

// Every insights route needs a logged-in user; identity comes from the
// verified login token (req.userId), never from the request body.
router.get("/planting-signals", protect, getPlantingSignals);
router.get("/price-forecast/:cropType", protect, getPriceForecast);
router.get("/sell-or-hold", protect, getSellOrHold);
router.get("/profit-plan/:cropType", protect, getProfitPlan);
router.post("/price-alerts/generate", protect, generatePriceAlerts);
// District Planting Advisor: "what should I plant NEXT", across every crop at once.
router.get("/next-season-advisor", protect, getNextSeasonAdvisor);
// Anonymized Benchmarking: my cost-per-kg vs the district/national average (aggregates only).
router.get("/benchmark", protect, getBenchmark);

module.exports = router;
