const express = require("express");
const router = express.Router();
const { requireDataPartnerKey } = require("../middleware/dataPartnerAuth");
const { priceTrends, plantingDensity, demandSignals } = require("../controllers/dataPartnerController");

// DATA-AS-A-SERVICE: a licensed partner (fertilizer company, insurer,
// government body) calls these with its own API key — not a farmer/buyer
// login. Every response is anonymized, aggregate-only data (see
// controllers/dataPartnerController.js for exactly what is never returned).
router.use(requireDataPartnerKey);

router.get("/price-trends", priceTrends);
router.get("/planting-density", plantingDensity);
router.get("/demand-signals", demandSignals);

module.exports = router;
