const express = require("express");
const router = express.Router();
const { syncTimeline, getMyTimelines } = require("../controllers/timelineController");

router.post("/sync-queue", syncTimeline);
router.get("/mine", getMyTimelines);

module.exports = router;
