const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const r = require("../controllers/returnTripController");

router.use(protect);
router.post("/estimate", requireRole("farmer"), r.deliveryEstimate);
router.get("/mine", r.myTrips);
router.get("/", requireRole("farmer"), r.listTrips);
router.post("/", requireRole("driver"), r.createTrip);
router.post("/:id/book", requireRole("farmer"), r.book);
router.post("/:id/bookings/:bookingId", r.updateBooking);
router.post("/:id/cancel", requireRole("driver"), r.cancelTrip);

module.exports = router;
