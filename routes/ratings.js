const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const r = require("../controllers/ratingController");

router.use(protect);
router.post("/", r.rate);
router.post("/trust", r.trustBatch);
router.get("/received", r.received);

module.exports = router;
