const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const l = require("../controllers/ledgerController");

router.use(protect, requireRole("farmer"));
router.get("/summary", l.summary);
router.get("/", l.listEntries);
router.post("/", l.addEntry);
router.delete("/:id", l.deleteEntry);

module.exports = router;
