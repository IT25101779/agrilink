const express = require("express");
const { protect, requireRole } = require("../middleware/authMiddleware");
const { bindIdentity, ownerOf } = require("../middleware/identity");
const LorryFleetTracking = require("../models/LorryFleetTracking");
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

router.use(protect, bindIdentity);

// Cargo bookings may be changed by the lorry's driver or by the farmer who made that booking.
async function lorryParty(req, res, next) {
  try {
    const lorry = await LorryFleetTracking.findById(req.params.id).select("driver cargoBookings").lean();
    if (!lorry) return res.status(404).json({ success: false, message: "Lorry not found." });
    const booking = (lorry.cargoBookings || []).find((b) => String(b._id) === String(req.params.bookingId));
    const allowed = req.userRole === "admin" || String(lorry.driver) === String(req.userId) || (booking && String(booking.farmer) === String(req.userId));
    if (!allowed) return res.status(403).json({ success: false, message: "This is not your booking." });
    next();
  } catch (error) {
    return res.status(400).json({ success: false, message: "Invalid request." });
  }
}

router.post("/lorries", requireRole("driver"), upsertLorryStatus);
router.get("/lorries/nearby", getNearbyLorries);
router.get("/lorries/mine", getMyLorry);
router.patch("/lorries/:id/location", ownerOf(LorryFleetTracking, "driver"), updateLocation);
router.patch("/lorries/:id/toggle-tracking", ownerOf(LorryFleetTracking, "driver"), toggleTracking);
router.post("/lorries/:id/cargo-request", requireRole("farmer"), requestCargo);
router.patch("/lorries/:id/cargo/:bookingId", lorryParty, updateCargoBooking);

module.exports = router;
