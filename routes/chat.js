const express = require("express");
const { protect, requireRole } = require("../middleware/authMiddleware");
const { bindIdentity, ownerOf } = require("../middleware/identity");
const router = express.Router();
const { sendMessage, getHistory } = require("../controllers/chatController");

router.use(protect, bindIdentity);
router.post("/message", sendMessage);
router.get("/history", getHistory);

module.exports = router;
