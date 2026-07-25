const express = require("express");
const router = express.Router();
const { scanCropImage, getOutbreakAlerts } = require("../controllers/diseaseController");

router.post("/scan", scanCropImage);
router.get("/outbreak-alerts", getOutbreakAlerts);

module.exports = router;
