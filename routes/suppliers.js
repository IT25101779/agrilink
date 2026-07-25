const express = require("express");
const router = express.Router();
const { getNearbySuppliers, createSupplier, getAllSuppliers, updateSupplier, deleteSupplier } = require("../controllers/supplierController");
const { protect, requireRole } = require("../middleware/authMiddleware");

router.get("/nearby", getNearbySuppliers);
router.get("/", protect, requireRole("admin"), getAllSuppliers);
router.post("/", protect, requireRole("admin"), createSupplier);
router.patch("/:id", protect, requireRole("admin"), updateSupplier);
router.delete("/:id", protect, requireRole("admin"), deleteSupplier);

module.exports = router;
