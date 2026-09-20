const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const s = require("../controllers/surveyController");

router.use(protect, requireRole("farmer"));
router.get("/open", s.openSurveys);
router.post("/:id/respond", s.respond);

module.exports = router;
