const express = require("express");
const { protect, requireRole } = require("../middleware/authMiddleware");
const { bindIdentity, ownerOf } = require("../middleware/identity");
const MarketplaceListing = require("../models/MarketplaceListing");
const router = express.Router();
const {
  createListing,
  getListings,
  updateListing,
  rejectAndRedirectListing,
  confirmOrder,
  completeSale,
} = require("../controllers/marketplaceController");

router.use(protect, bindIdentity);
router.post("/listings", createListing);
router.get("/listings", getListings);
router.patch("/listings/:id", ownerOf(MarketplaceListing, "farmer"), updateListing);
router.patch("/listings/:id/reject", rejectAndRedirectListing);
router.patch("/listings/:id/confirm-order", confirmOrder);
router.patch("/listings/:id/complete-sale", completeSale);

module.exports = router;
