const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const p = require("../controllers/priceController");

router.use(protect);
router.get("/board", p.board);
router.get("/history/:crop", p.history);
router.post("/report", requireRole("farmer"), p.report);
router.get("/alerts", requireRole("farmer"), p.myAlerts);
router.post("/alerts", requireRole("farmer"), p.createAlert);
router.delete("/alerts/:id", requireRole("farmer"), p.deleteAlert);

module.exports = router;
