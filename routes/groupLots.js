const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const { createLot, listLots, joinLot, leaveLot, cancelLot, claimLot } = require("../controllers/groupLotController");

// Everyone logged in can look at lots; only farmers can create / join /
// leave / cancel; only buyers can claim a full lot.
router.get("/", protect, listLots);
router.post("/", protect, requireRole("farmer"), createLot);
router.post("/:id/join", protect, requireRole("farmer"), joinLot);
router.post("/:id/leave", protect, requireRole("farmer"), leaveLot);
router.post("/:id/cancel", protect, requireRole("farmer"), cancelLot);
router.post("/:id/claim", protect, requireRole("buyer"), claimLot);

module.exports = router;
