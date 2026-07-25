const LorryFleetTracking = require("../models/LorryFleetTracking");

/**
 * POST /api/logistics/lorries
 * Driver declares/updates their status: vehicle info, capacity, destination
 * hub, and current GPS position. Upserts one record per driver — a driver
 * only ever has one active lorry record, updated as their trip progresses.
 */
async function upsertLorryStatus(req, res) {
  try {
    const {
      driver,
      vehicleRegistrationNo,
      totalCapacityKg,
      remainingCapacityKg,
      latitude,
      longitude,
      destinationHub,
      isTrackingActive,
    } = req.body;

    if (!driver || !vehicleRegistrationNo || !totalCapacityKg || !destinationHub || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: "driver, vehicleRegistrationNo, totalCapacityKg, destinationHub, latitude, and longitude are required.",
      });
    }

    const lorry = await LorryFleetTracking.findOneAndUpdate(
      { driver },
      {
        driver,
        vehicleRegistrationNo,
        totalCapacityKg,
        remainingCapacityKg: remainingCapacityKg !== undefined ? remainingCapacityKg : totalCapacityKg,
        destinationHub,
        currentLocation: { type: "Point", coordinates: [longitude, latitude] },
        isTrackingActive: isTrackingActive !== undefined ? isTrackingActive : true,
        routeStatus: "en_route",
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({ success: true, data: lorry });
  } catch (error) {
    console.error("upsertLorryStatus error:", error);
    return res.status(500).json({ success: false, message: "Failed to update lorry status.", error: error.message });
  }
}

/**
 * PATCH /api/logistics/lorries/:id/location
 * Lightweight GPS ping — called frequently by the driver app while
 * isTrackingActive is true, without touching the rest of the record.
 */
async function updateLocation(req, res) {
  try {
    const { id } = req.params;
    const { latitude, longitude } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, message: "latitude and longitude are required." });
    }

    const lorry = await LorryFleetTracking.findByIdAndUpdate(
      id,
      { currentLocation: { type: "Point", coordinates: [longitude, latitude] } },
      { new: true }
    );

    if (!lorry) {
      return res.status(404).json({ success: false, message: "Lorry record not found." });
    }
    return res.status(200).json({ success: true, data: lorry });
  } catch (error) {
    console.error("updateLocation error:", error);
    return res.status(500).json({ success: false, message: "Failed to update location.", error: error.message });
  }
}

/**
 * PATCH /api/logistics/lorries/:id/toggle-tracking
 */
async function toggleTracking(req, res) {
  try {
    const { id } = req.params;
    const { isTrackingActive } = req.body;

    const lorry = await LorryFleetTracking.findByIdAndUpdate(
      id,
      { isTrackingActive: !!isTrackingActive },
      { new: true }
    );

    if (!lorry) {
      return res.status(404).json({ success: false, message: "Lorry record not found." });
    }
    return res.status(200).json({ success: true, data: lorry });
  } catch (error) {
    console.error("toggleTracking error:", error);
    return res.status(500).json({ success: false, message: "Failed to toggle tracking.", error: error.message });
  }
}

/**
 * GET /api/logistics/lorries/nearby?latitude=X&longitude=Y&radiusKm=25&destinationHub=Dambulla
 * Farmer-facing search: finds actively-tracked lorries within radius with
 * spare capacity, optionally filtered by destination hub.
 */
async function getNearbyLorries(req, res) {
  try {
    const { latitude, longitude, radiusKm, destinationHub } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: "latitude and longitude are required." });
    }

    const radiusMeters = radiusKm ? Number(radiusKm) * 1000 : 25000;

    const filter = {
      isTrackingActive: true,
      remainingCapacityKg: { $gt: 0 },
      currentLocation: {
        $near: {
          $geometry: { type: "Point", coordinates: [Number(longitude), Number(latitude)] },
          $maxDistance: radiusMeters,
        },
      },
    };
    if (destinationHub) filter.destinationHub = destinationHub;

    const lorries = await LorryFleetTracking.find(filter).populate("driver", "fullName phone");

    return res.status(200).json({ success: true, count: lorries.length, data: lorries });
  } catch (error) {
    console.error("getNearbyLorries error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch nearby lorries.", error: error.message });
  }
}

/**
 * GET /api/logistics/lorries/mine?driverId=X
 * Driver's own current status + incoming cargo requests.
 */
async function getMyLorry(req, res) {
  try {
    const { driverId } = req.query;
    if (!driverId) {
      return res.status(400).json({ success: false, message: "driverId is required." });
    }

    const lorry = await LorryFleetTracking.findOne({ driver: driverId })
      .populate("cargoBookings.farmer", "fullName phone")
      .populate("cargoBookings.listingRef", "cropType quantityKg");

    return res.status(200).json({ success: true, data: lorry || null });
  } catch (error) {
    console.error("getMyLorry error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch lorry.", error: error.message });
  }
}

/**
 * POST /api/logistics/lorries/:id/cargo-request
 * A farmer requests shared cargo space on a moving/available vehicle.
 */
async function requestCargo(req, res) {
  try {
    const { id } = req.params;
    const { farmer, listingRef, weightKg, latitude, longitude } = req.body;

    if (!farmer || !weightKg || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, message: "farmer, weightKg, latitude, and longitude are required." });
    }

    const lorry = await LorryFleetTracking.findById(id);
    if (!lorry) {
      return res.status(404).json({ success: false, message: "Lorry not found." });
    }
    if (weightKg > lorry.remainingCapacityKg) {
      return res.status(409).json({
        success: false,
        message: `Requested weight (${weightKg}kg) exceeds remaining capacity (${lorry.remainingCapacityKg}kg).`,
      });
    }

    lorry.cargoBookings.push({
      farmer,
      listingRef,
      weightKg,
      pickupLocation: { type: "Point", coordinates: [longitude, latitude] },
      status: "requested",
    });

    await lorry.save();

    return res.status(201).json({ success: true, data: lorry });
  } catch (error) {
    console.error("requestCargo error:", error);
    return res.status(500).json({ success: false, message: "Failed to request cargo space.", error: error.message });
  }
}

/**
 * PATCH /api/logistics/lorries/:id/cargo/:bookingId
 * Driver confirms, picks up, delivers, or cancels a cargo booking.
 * Confirming a booking reserves capacity by decrementing remainingCapacityKg;
 * cancelling a previously-confirmed booking returns that capacity.
 */
async function updateCargoBooking(req, res) {
  try {
    const { id, bookingId } = req.params;
    const { status } = req.body;

    const validStatuses = ["requested", "confirmed", "picked_up", "delivered", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of: ${validStatuses.join(", ")}` });
    }

    const lorry = await LorryFleetTracking.findById(id);
    if (!lorry) {
      return res.status(404).json({ success: false, message: "Lorry not found." });
    }

    const booking = lorry.cargoBookings.id(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Cargo booking not found." });
    }

    const wasConfirmed = ["confirmed", "picked_up", "delivered"].includes(booking.status);
    const willBeConfirmed = ["confirmed", "picked_up", "delivered"].includes(status);

    // Reserve capacity the moment a booking first becomes confirmed.
    if (!wasConfirmed && willBeConfirmed) {
      if (booking.weightKg > lorry.remainingCapacityKg) {
        return res.status(409).json({ success: false, message: "Not enough remaining capacity to confirm this booking." });
      }
      lorry.remainingCapacityKg -= booking.weightKg;
    }
    // Release capacity if a confirmed booking gets cancelled.
    if (wasConfirmed && status === "cancelled") {
      lorry.remainingCapacityKg += booking.weightKg;
    }

    booking.status = status;
    await lorry.save();

    return res.status(200).json({ success: true, data: lorry });
  } catch (error) {
    console.error("updateCargoBooking error:", error);
    return res.status(500).json({ success: false, message: "Failed to update cargo booking.", error: error.message });
  }
}

module.exports = {
  upsertLorryStatus,
  updateLocation,
  toggleTracking,
  getNearbyLorries,
  getMyLorry,
  requestCargo,
  updateCargoBooking,
};
