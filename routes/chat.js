const express = require("express");
const router = express.Router();
const { sendMessage, getHistory } = require("../controllers/chatController");

router.post("/message", sendMessage);
router.get("/history", getHistory);

module.exports = router;
