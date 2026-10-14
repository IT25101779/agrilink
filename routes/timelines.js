const express = require("express");
const { protect, requireRole } = require("../middleware/authMiddleware");
const { bindIdentity, ownerOf } = require("../middleware/identity");
const router = express.Router();
const { syncTimeline, getMyTimelines, deleteTimeline } = require("../controllers/timelineController");

router.use(protect, bindIdentity);
router.post("/sync-queue", syncTimeline);
router.get("/mine", getMyTimelines);
router.delete("/:localId", deleteTimeline);

module.exports = router;
