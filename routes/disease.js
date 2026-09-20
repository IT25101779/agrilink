const express = require("express");
const { protect, requireRole } = require("../middleware/authMiddleware");
const { bindIdentity, ownerOf } = require("../middleware/identity");
const router = express.Router();
const { scanCropImage, getOutbreakAlerts } = require("../controllers/diseaseController");

router.use(protect, bindIdentity);
router.post("/scan", scanCropImage);
router.get("/outbreak-alerts", getOutbreakAlerts);

module.exports = router;
