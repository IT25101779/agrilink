const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const { bindIdentity } = require("../middleware/identity");
const {
  createContract,
  listContracts,
  getMyContracts,
  getMyCommitments,
  expressInterest,
  confirmCommitment,
  cancelContract,
} = require("../controllers/forwardContractController");

router.use(protect, bindIdentity);

router.post("/", requireRole("buyer"), createContract);
router.get("/", listContracts);
router.get("/mine", requireRole("buyer"), getMyContracts);
router.get("/my-commitments", requireRole("farmer"), getMyCommitments);
router.post("/:id/interest", requireRole("farmer"), expressInterest);
router.patch("/:id/commitments/:commitmentId/confirm", confirmCommitment);
router.patch("/:id/cancel", requireRole("buyer"), cancelContract);

module.exports = router;
