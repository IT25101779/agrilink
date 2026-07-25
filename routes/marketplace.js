const express = require("express");
const router = express.Router();
const {
  createListing,
  getListings,
  rejectAndRedirectListing,
  confirmOrder,
} = require("../controllers/marketplaceController");

router.post("/listings", createListing);
router.get("/listings", getListings);
router.patch("/listings/:id/reject", rejectAndRedirectListing);
router.patch("/listings/:id/confirm-order", confirmOrder);

module.exports = router;
