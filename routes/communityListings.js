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

router.post("/", createListing);
router.get("/nearby", getNearbyListings);
router.get("/mine", getMyListings);
router.patch("/:id", updateListing);
router.delete("/:id", deleteListing);

// Admin oversight/moderation
router.get("/", protect, requireRole("admin"), getAllListings);
router.delete("/:id/admin", protect, requireRole("admin"), adminDeleteListing);

module.exports = router;
