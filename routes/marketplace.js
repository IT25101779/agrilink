const express = require("express");
const router = express.Router();
const {
  createListing,
  getListings,
  updateListing,
  rejectAndRedirectListing,
  confirmOrder,
  completeSale,
} = require("../controllers/marketplaceController");

router.post("/listings", createListing);
router.get("/listings", getListings);
router.patch("/listings/:id", updateListing);
router.patch("/listings/:id/reject", rejectAndRedirectListing);
router.patch("/listings/:id/confirm-order", confirmOrder);
router.patch("/listings/:id/complete-sale", completeSale);

module.exports = router;
