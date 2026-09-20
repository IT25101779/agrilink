const mongoose = require("mongoose");
const ReturnTrip = require("../models/ReturnTrip");
const User = require("../models/User");
const { canonicalDistrict } = require("../utils/chatConfig");
const { estimateDelivery } = require("../utils/deliveryEstimate");
const { notifyFarmer } = require("../utils/notify");
const { computeTrust } = require("../utils/trust");
const Block = require("../models/Block");

const HUBS = ["Dambulla", "Colombo_Manning_Market", "Pettah", "Kandy", "Jaffna", "Other"];

function fail(res, status, message, code) {
  return res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
}

const committedKg = (trip) => trip.bookings.filter((b) => ["requested", "confirmed"].includes(b.status)).reduce((sum, b) => sum + b.weightKg, 0);

/** POST /api/logistics/delivery-estimate { cropType, harvestDate?, district? } */
async function deliveryEstimate(req, res) {
  try {
    const b = req.body || {};
    if (!b.cropType) return fail(res, 400, "Choose a crop.");
    let district = b.district;
    if (!district) {
      const me = await User.findById(req.userId).select("farmerProfile.district");
      district = me && me.farmerProfile ? me.farmerProfile.district : "";
    }
    const estimate = estimateDelivery({ cropType: b.cropType, harvestDate: b.harvestDate, district });
    if (!estimate) return fail(res, 400, "Tell us your district first (Profile → Edit).", "no_district");
    return res.status(200).json({ success: true, data: estimate });
  } catch (error) {
    console.error("deliveryEstimate error:", error);
    return fail(res, 500, "Failed to estimate the delivery.");
  }
}

/** POST /api/return-trips — a driver offers an empty return journey. */
async function createTrip(req, res) {
  try {
    if (req.userRole !== "driver") return fail(res, 403, "Only drivers can post return trips.");
    const b = req.body || {};
    if (!HUBS.includes(b.fromHub)) return fail(res, 400, "Choose where the trip starts.");
    const district = canonicalDistrict(b.toDistrict);
    if (!district) return fail(res, 400, "Choose a valid destination district.");
    const departAt = new Date(b.departAt);
    if (isNaN(departAt) || departAt.getTime() < Date.now() - 3600000 || departAt.getTime() > Date.now() + 14 * 86400000) return fail(res, 400, "Departure must be within the next 14 days.");
    const kg = Number(b.availableKg), price = Number(b.pricePerKg);
    if (!Number.isFinite(kg) || kg < 20 || kg > 20000) return fail(res, 400, "Space must be 20–20,000 kg.");
    if (!Number.isFinite(price) || price < 1 || price > 500) return fail(res, 400, "Price must be LKR 1–500 per kg.");
    const regular = b.regularPricePerKg === undefined || b.regularPricePerKg === "" ? undefined : Number(b.regularPricePerKg);
    if (regular !== undefined && (!Number.isFinite(regular) || regular < price || regular > 1000)) return fail(res, 400, "The regular price must be at least the trip price.");
    const me = await User.findById(req.userId).select("driverProfile");
    const trip = await ReturnTrip.create({ driver: req.userId, vehicleRegistrationNo: (me.driverProfile && me.driverProfile.vehicleRegistrationNo) || "", fromHub: b.fromHub, toDistrict: district, departAt, availableKg: kg, pricePerKg: price, regularPricePerKg: regular, note: String(b.note || "").trim().slice(0, 200) });
    return res.status(201).json({ success: true, data: { id: String(trip._id) } });
  } catch (error) {
    console.error("createTrip error:", error);
    return fail(res, 500, "Failed to post the trip.");
  }
}

function shapeTrip(trip, driver, trust, viewerId, viewerIsDriver) {
  const remaining = Math.max(0, trip.availableKg - committedKg(trip));
  const mine = trip.bookings.filter((b) => String(b.farmer._id || b.farmer) === String(viewerId));
  const data = {
    id: String(trip._id), fromHub: trip.fromHub, toDistrict: trip.toDistrict, departAt: trip.departAt, availableKg: trip.availableKg, remainingKg: remaining,
    pricePerKg: trip.pricePerKg, regularPricePerKg: trip.regularPricePerKg || null,
    savingPercent: trip.regularPricePerKg ? Math.round((1 - trip.pricePerKg / trip.regularPricePerKg) * 100) : null,
    note: trip.note, status: trip.status,
    driver: { firstName: String(driver.fullName || "").split(" ")[0], hasAvatar: Boolean(driver.avatarUpdatedAt), id: String(driver._id), trust },
  };
  const myConfirmed = mine.some((b) => b.status === "confirmed");
  if (viewerIsDriver) {
    data.vehicleRegistrationNo = trip.vehicleRegistrationNo;
    data.bookings = trip.bookings.map((b) => ({ id: String(b._id), weightKg: b.weightKg, cropType: b.cropType, status: b.status, farmer: b.farmer && b.farmer.fullName ? { name: b.farmer.fullName, phone: b.status === "confirmed" ? b.farmer.phone : undefined } : undefined }));
  } else {
    data.myBookings = mine.map((b) => ({ id: String(b._id), weightKg: b.weightKg, cropType: b.cropType, status: b.status }));
    if (myConfirmed) { data.driver.phone = driver.phone; data.vehicleRegistrationNo = trip.vehicleRegistrationNo; }
  }
  return data;
}

/** GET /api/return-trips?district=&hub= — open trips a farmer can join. */
async function listTrips(req, res) {
  try {
    const filter = { status: "open", departAt: { $gte: new Date(Date.now() - 3600000) } };
    if (req.query.district) { const d = canonicalDistrict(req.query.district); if (!d) return fail(res, 400, "Unknown district."); filter.toDistrict = d; }
    if (req.query.hub && HUBS.includes(req.query.hub)) filter.fromHub = req.query.hub;
    const trips = await ReturnTrip.find(filter).sort({ departAt: 1 }).limit(60);
    const drivers = await User.find({ _id: { $in: trips.map((t) => t.driver) } }).select("fullName phone avatarUpdatedAt");
    const driverMap = new Map(drivers.map((d) => [String(d._id), d]));
    const trust = await computeTrust(trips.map((t) => t.driver));
    const data = trips.map((t) => shapeTrip(t, driverMap.get(String(t.driver)), trust[String(t.driver)], req.userId, false)).filter((t) => t.remainingKg > 0);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("listTrips error:", error);
    return fail(res, 500, "Failed to load return trips.");
  }
}

/** GET /api/return-trips/mine — a driver's own trips (with bookings), or a farmer's trips they booked. */
async function myTrips(req, res) {
  try {
    const isDriver = req.userRole === "driver";
    const filter = isDriver ? { driver: req.userId } : { "bookings.farmer": req.userId };
    const trips = await ReturnTrip.find(filter).sort({ departAt: -1 }).limit(40).populate("bookings.farmer", "fullName phone");
    const drivers = await User.find({ _id: { $in: trips.map((t) => t.driver) } }).select("fullName phone avatarUpdatedAt");
    const driverMap = new Map(drivers.map((d) => [String(d._id), d]));
    const trust = await computeTrust(trips.map((t) => t.driver));
    return res.status(200).json({ success: true, data: trips.map((t) => shapeTrip(t, driverMap.get(String(t.driver)), trust[String(t.driver)], req.userId, isDriver)) });
  } catch (error) {
    console.error("myTrips error:", error);
    return fail(res, 500, "Failed to load your trips.");
  }
}

/** POST /api/return-trips/:id/book { weightKg, cropType? } — a farmer reserves space. */
async function book(req, res) {
  try {
    if (req.userRole !== "farmer") return fail(res, 403, "Only farmers can book space.");
    const trip = await ReturnTrip.findById(req.params.id);
    if (!trip || trip.status !== "open" || trip.departAt.getTime() < Date.now() - 3600000) return fail(res, 404, "This trip is no longer available.");
    const kg = Number((req.body || {}).weightKg);
    if (!Number.isFinite(kg) || kg < 5) return fail(res, 400, "Enter at least 5 kg.");
    if (await Block.exists({ $or: [{ blocker: trip.driver, blocked: req.userId }, { blocker: req.userId, blocked: trip.driver }] })) return fail(res, 403, "You can't book this driver.", "blocked");
    if (trip.bookings.some((b) => String(b.farmer) === String(req.userId) && ["requested", "confirmed"].includes(b.status))) return fail(res, 409, "You already have a booking on this trip.", "duplicate");
    if (kg > trip.availableKg - committedKg(trip)) return fail(res, 409, "Not enough space left on this trip.", "full");
    trip.bookings.push({ farmer: req.userId, weightKg: Math.round(kg), cropType: String((req.body || {}).cropType || "").slice(0, 40) });
    await trip.save();
    return res.status(201).json({ success: true, message: "Requested. The driver will confirm soon." });
  } catch (error) {
    console.error("book error:", error);
    return fail(res, 500, "Failed to book.");
  }
}

/** POST /api/return-trips/:id/bookings/:bookingId { action: "confirm"|"reject"|"cancel" } */
async function updateBooking(req, res) {
  try {
    const trip = await ReturnTrip.findById(req.params.id);
    if (!trip) return fail(res, 404, "Trip not found.");
    const booking = trip.bookings.id(req.params.bookingId);
    if (!booking) return fail(res, 404, "Booking not found.");
    const action = (req.body || {}).action;
    const isDriver = String(trip.driver) === String(req.userId);
    const isOwner = String(booking.farmer) === String(req.userId);
    if (action === "cancel") {
      if (!isOwner) return fail(res, 403, "Only the farmer can cancel.");
      if (!["requested", "confirmed"].includes(booking.status)) return fail(res, 409, "Already closed.");
      booking.status = "cancelled";
    } else if (action === "confirm" || action === "reject") {
      if (!isDriver) return fail(res, 403, "Only the driver can do this.");
      if (booking.status !== "requested") return fail(res, 409, "Already answered.");
      booking.status = action === "confirm" ? "confirmed" : "rejected";
      await notifyFarmer(booking.farmer, { type: "order_update", dedupeKey: `trip-${trip._id}-${booking._id}-${booking.status}`, title: booking.status === "confirmed" ? "Truck space confirmed" : "Truck space declined", message: booking.status === "confirmed" ? `Your ${booking.weightKg} kg is booked on the truck to ${trip.toDistrict}. Open Logistics to see the driver's number.` : "The driver couldn't take your load on this trip. Try another trip." });
    } else return fail(res, 400, "Unknown action.");
    await trip.save();
    return res.status(200).json({ success: true, status: booking.status });
  } catch (error) {
    console.error("updateBooking error:", error);
    return fail(res, 500, "Failed.");
  }
}

async function cancelTrip(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 400, "Invalid trip.");
    const trip = await ReturnTrip.findOne({ _id: req.params.id, driver: req.userId });
    if (!trip) return fail(res, 404, "Trip not found.");
    trip.status = "cancelled";
    for (const b of trip.bookings) if (["requested", "confirmed"].includes(b.status)) { b.status = "cancelled"; await notifyFarmer(b.farmer, { type: "order_update", dedupeKey: `trip-cancel-${trip._id}-${b._id}`, title: "Trip cancelled", message: `The driver cancelled the trip to ${trip.toDistrict}. Please pick another truck.` }); }
    await trip.save();
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("cancelTrip error:", error);
    return fail(res, 500, "Failed to cancel the trip.");
  }
}

module.exports = { deliveryEstimate, createTrip, listTrips, myTrips, book, updateBooking, cancelTrip };
