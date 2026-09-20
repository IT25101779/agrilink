const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const s = require("../controllers/safetyController");

router.post("/orders/:id/photos", protect, s.addOrderPhoto);
router.get("/orders/:id/photos", protect, s.listOrderPhotos);
router.get("/photos/:id", protect, s.viewPhoto);
router.post("/orders/:id/dispute", protect, s.openDispute);
router.get("/disputes/mine", protect, s.myDisputes);
router.post("/disputes/:id/message", protect, s.disputeMessage);
router.post("/reports", protect, s.reportUser);
router.get("/blocks", protect, s.myBlocks);
router.post("/blocks", protect, s.blockUser);
router.delete("/blocks/:userId", protect, s.unblockUser);
router.post("/feedback", protect, s.sendFeedback);

module.exports = router;
