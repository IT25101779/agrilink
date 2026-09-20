const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const c = require("../controllers/communityController");

router.use(protect);
// wildlife
router.post("/wildlife", requireRole("farmer"), c.reportSighting);
router.get("/wildlife/nearby", requireRole("farmer"), c.nearbySightings);
router.post("/wildlife/:id/confirm", requireRole("farmer"), c.confirmSighting);
// where to get real help
router.get("/offices", c.listOffices);
// questions for an officer
router.post("/questions", requireRole("farmer"), c.askQuestion);
router.get("/questions/mine", requireRole("farmer"), c.myQuestions);
router.get("/officer/overview", requireRole("officer"), c.officerOverview);
router.post("/officer/questions/:id/answer", requireRole("officer"), c.answerQuestion);

module.exports = router;
