const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const account = require("../controllers/accountController");

router.get("/legal/privacy", account.privacyPage);
router.get("/app/version", account.appVersion);
router.post("/notifications/device", protect, account.registerDevice);
router.delete("/notifications/device", protect, account.unregisterDevice);

module.exports = router;
