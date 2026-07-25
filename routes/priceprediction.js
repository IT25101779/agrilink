const express = require("express");
const router = express.Router();
const { getPricePrediction } = require("../controllers/pricePredictionController");

router.get("/:cropType", getPricePrediction);

module.exports = router;
