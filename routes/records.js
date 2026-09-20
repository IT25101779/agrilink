const express = require("express");
const router = express.Router();
const jwtless = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const r = require("../controllers/recordsController");

// Printable reports open from a signed link (no login header possible in a browser) — the link itself expires in 48 hours.
jwtless.get("/report/:kind", r.viewReport);

router.use(protect);
router.post("/report-link/:kind", requireRole("farmer"), r.reportLink);
router.get("/yields", requireRole("farmer"), r.listYields);
router.post("/yields", requireRole("farmer"), r.addYield);
router.delete("/yields/:id", requireRole("farmer"), r.deleteYield);
router.get("/subsidies", requireRole("farmer"), r.listSubsidies);
router.post("/subsidies", requireRole("farmer"), r.addSubsidy);
router.delete("/subsidies/:id", requireRole("farmer"), r.deleteSubsidy);
router.get("/support-prices", r.listSupportPrices);
router.post("/price-check", r.priceCheck);
router.get("/damage", requireRole("farmer"), r.listDamage);
router.post("/damage", requireRole("farmer"), r.addDamage);
router.get("/rain-planner", requireRole("farmer"), r.rainPlanner);

module.exports = { router, publicRouter: jwtless };
