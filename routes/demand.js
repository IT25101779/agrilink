const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const {
  createRequest,
  listRequests,
  makeOffer,
  withdrawOffer,
  acceptOffer,
  declineOffer,
  cancelRequest,
} = require("../controllers/demandController");

// Buyers post and manage requests; farmers browse and send offers.
router.get("/", protect, listRequests);
router.post("/", protect, requireRole("buyer"), createRequest);
router.post("/:id/cancel", protect, requireRole("buyer"), cancelRequest);
router.post("/:id/offers", protect, requireRole("farmer"), makeOffer);
router.post("/:id/offers/:offerId/withdraw", protect, requireRole("farmer"), withdrawOffer);
router.post("/:id/offers/:offerId/accept", protect, requireRole("buyer"), acceptOffer);
router.post("/:id/offers/:offerId/decline", protect, requireRole("buyer"), declineOffer);

module.exports = router;
