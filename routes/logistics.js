const express = require("express");
const router = express.Router();
const {
  upsertLorryStatus,
  updateLocation,
  toggleTracking,
  getNearbyLorries,
  getMyLorry,
  requestCargo,
  updateCargoBooking,
} = require("../controllers/logisticsController");

router.post("/lorries", upsertLorryStatus);
router.get("/lorries/nearby", getNearbyLorries);
router.get("/lorries/mine", getMyLorry);
router.patch("/lorries/:id/location", updateLocation);
router.patch("/lorries/:id/toggle-tracking", toggleTracking);
router.post("/lorries/:id/cargo-request", requestCargo);
router.patch("/lorries/:id/cargo/:bookingId", updateCargoBooking);

module.exports = router;
