const express = require("express");
const router = express.Router();
const { getMetrics } = require("../controllers/adminController");
const { protect, requireRole } = require("../middleware/authMiddleware");

router.get("/metrics", protect, requireRole("admin"), getMetrics);

module.exports = router;
