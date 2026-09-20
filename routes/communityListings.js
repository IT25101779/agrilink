const express = require("express");
const router = express.Router();
const {
  createListing,
  getNearbyListings,
  getMyListings,
  updateListing,
  deleteListing,
  getAllListings,
  adminDeleteListing,
} = require("../controllers/communityListingController");
const { protect, requireRole } = require("../middleware/authMiddleware");
const { bindIdentity, ownerOf } = require("../middleware/identity");
const CommunityListing = require("../models/CommunityListing");

router.post("/", protect, bindIdentity, createListing);
router.get("/nearby", protect, getNearbyListings);
router.get("/mine", protect, bindIdentity, getMyListings);
router.patch("/:id", protect, bindIdentity, ownerOf(CommunityListing, "farmer"), updateListing);
router.delete("/:id", protect, bindIdentity, ownerOf(CommunityListing, "farmer"), deleteListing);

// Admin oversight/moderation
router.get("/", protect, requireRole("admin"), getAllListings);
router.delete("/:id/admin", protect, requireRole("admin"), adminDeleteListing);

module.exports = router;
