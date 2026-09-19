const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const c = require("../controllers/groupChatController");

// Group chat is for farmers. Identity always comes from the login token.
router.use(protect, requireRole("farmer"));

router.get("/groups", c.listMyGroups);
router.get("/groups/suggested", c.suggestedGroups);
router.get("/groups/search", c.searchGroups);
router.post("/groups/join", c.joinGroup);
router.post("/groups/leave", c.leaveGroup);
router.post("/groups/mute", c.setMuted);
router.post("/groups/block", c.setBlocked);

router.get("/messages", c.getMessages);
router.post("/messages", c.postMessage);
router.post("/messages/helpful", c.toggleHelpful);
router.post("/messages/report", c.reportMessage);
router.post("/messages/delete", c.deleteMyMessage);
router.post("/messages/translate", c.translateMessage);

router.get("/media/:id", c.getMedia);

module.exports = router;
