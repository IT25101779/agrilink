const LorryFleetTracking = require("../models/LorryFleetTracking");
const MarketShop = require("../models/MarketShop");
const LogisticsPricingConfig = require("../models/LogisticsPricingConfig");
const { logCommission } = require("../utils/commission");

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
 * PATCH /api/logistics/lorries/:id/accepting-cargo
 * "When the lorry is full, the driver should be able to mark it as full and
 * stop getting crops." Kept separate from isTrackingActive, which only
 * controls GPS visibility — a driver might still want to be visible/moving
 * while refusing new bookings.
 */
async function toggleAcceptingCargo(req, res) {
  try {
    const { id } = req.params;
    const { acceptingCargo } = req.body;

    const lorry = await LorryFleetTracking.findByIdAndUpdate(id, { acceptingCargo: !!acceptingCargo }, { new: true });
    if (!lorry) {
      return res.status(404).json({ success: false, message: "Lorry record not found." });
    }
    return res.status(200).json({ success: true, data: lorry });
  } catch (error) {
    console.error("toggleAcceptingCargo error:", error);
    return res.status(500).json({ success: false, message: "Failed to update.", error: error.message });
  }
}

/**
 * GET /api/logistics/shops?market=Kandy
 * The shop directory a farmer picks from when booking a lorry. Featured
 * shop (e.g. Kandy's No. 166, Samansiri Holdings) is sorted first.
 */
async function getShopsByMarket(req, res) {
  try {
    const { market } = req.query;
    const filter = market ? { market } : {};
    const shops = await MarketShop.find(filter).sort({ isFeatured: -1, shopNumber: 1 });
    return res.status(200).json({ success: true, count: shops.length, data: shops });
  } catch (error) {
    console.error("getShopsByMarket error:", error);
    return res.status(500).json({ success: false, message: "Failed to load shops.", error: error.message });
  }
}

/**
 * GET /api/logistics/pricing
 * Public (any logged-in user) — lets the farmer app show the rent before
 * booking. Returns the single tiered-pricing config, creating the default
 * one (LKR 50/kg under 10kg, LKR 20/kg from 10kg up) the first time.
 */
async function getPricingConfig(req, res) {
  try {
    const config = await LogisticsPricingConfig.getOrCreate();
    return res.status(200).json({ success: true, data: config });
  } catch (error) {
    console.error("getPricingConfig error:", error);
    return res.status(500).json({ success: false, message: "Failed to load pricing.", error: error.message });
  }
}

/**
 * PATCH /api/logistics/pricing — admin only.
 * "From admin site can change price, its for developers." Lets whoever
 * runs the platform retune the tiered lorry rate without a code change.
 */
async function updatePricingConfig(req, res) {
  try {
    const { tierThresholdKg, ratePerKgUnderThreshold, ratePerKgAtOrOverThreshold } = req.body;
    const config = await LogisticsPricingConfig.getOrCreate();
    if (tierThresholdKg !== undefined) config.tierThresholdKg = Number(tierThresholdKg);
    if (ratePerKgUnderThreshold !== undefined) config.ratePerKgUnderThreshold = Number(ratePerKgUnderThreshold);
    if (ratePerKgAtOrOverThreshold !== undefined) config.ratePerKgAtOrOverThreshold = Number(ratePerKgAtOrOverThreshold);
    config.updatedBy = req.userId;
    await config.save();
    return res.status(200).json({ success: true, data: config });
  } catch (error) {
    console.error("updatePricingConfig error:", error);
    return res.status(500).json({ success: false, message: "Failed to update pricing.", error: error.message });
  }
}

/**
 * GET /api/logistics/rent-quote?weightKg=35
 * Convenience endpoint so the mobile app can show "this will cost LKR X"
 * before the farmer commits to a booking, without duplicating the tiered
 * math on the client.
 */
async function getRentQuote(req, res) {
  try {
    const weightKg = Number(req.query.weightKg);
    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      return res.status(400).json({ success: false, message: "weightKg must be a positive number." });
    }
    const config = await LogisticsPricingConfig.getOrCreate();
    const rentLkr = LogisticsPricingConfig.calculateRent(config, weightKg);
    return res.status(200).json({ success: true, data: { weightKg, rentLkr, config } });
  } catch (error) {
    console.error("getRentQuote error:", error);
    return res.status(500).json({ success: false, message: "Failed to calculate rent.", error: error.message });
  }
}

/**
 * GET /api/logistics/lorries/my-bookings
 * A farmer's own cargo bookings across every lorry, newest first — so the
 * Logistics tab can show "your request is confirmed, here's the driver's
 * number" instead of the farmer having to remember which truck they asked.
 */
async function getMyCargoBookings(req, res) {
  try {
    const lorries = await LorryFleetTracking.find({ "cargoBookings.farmer": req.userId })
      .populate("driver", "fullName phone")
      .populate("cargoBookings.shop", "name shopNumber phone address market");

    const bookings = [];
    for (const lorry of lorries) {
      for (const booking of lorry.cargoBookings) {
        if (String(booking.farmer) === String(req.userId)) {
          bookings.push({
            bookingId: booking._id,
            lorryId: lorry._id,
            vehicleRegistrationNo: lorry.vehicleRegistrationNo,
            destinationHub: lorry.destinationHub,
            driver: lorry.driver,
            cropType: booking.cropType,
            weightKg: booking.weightKg,
            calculatedRentLkr: booking.calculatedRentLkr,
            shop: booking.shop,
            status: booking.status,
            createdAt: booking._id.getTimestamp(),
          });
        }
      }
    }
    bookings.sort((a, b) => b.createdAt - a.createdAt);
    return res.status(200).json({ success: true, count: bookings.length, data: bookings });
  } catch (error) {
    console.error("getMyCargoBookings error:", error);
    return res.status(500).json({ success: false, message: "Failed to load your bookings.", error: error.message });
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
      acceptingCargo: true, // a driver who marked their lorry "full" stops showing up for new requests
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
    const { farmer, listingRef, cropType, weightKg, shopId, latitude, longitude } = req.body;

    if (!farmer || !weightKg || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, message: "farmer, weightKg, latitude, and longitude are required." });
    }

    const lorry = await LorryFleetTracking.findById(id);
    if (!lorry) {
      return res.status(404).json({ success: false, message: "Lorry not found." });
    }
    if (!lorry.acceptingCargo) {
      return res.status(409).json({ success: false, message: "This lorry is full and isn't accepting more crops right now." });
    }
    if (weightKg > lorry.remainingCapacityKg) {
      return res.status(409).json({
        success: false,
        message: `Requested weight (${weightKg}kg) exceeds remaining capacity (${lorry.remainingCapacityKg}kg).`,
      });
    }

    let shop = null;
    if (shopId) {
      shop = await MarketShop.findById(shopId);
      if (!shop) return res.status(404).json({ success: false, message: "Chosen shop not found." });
    }

    const pricingConfig = await LogisticsPricingConfig.getOrCreate();
    const calculatedRentLkr = LogisticsPricingConfig.calculateRent(pricingConfig, weightKg);

    lorry.cargoBookings.push({
      farmer,
      listingRef,
      cropType,
      weightKg,
      shop: shop ? shop._id : undefined,
      calculatedRentLkr,
      pickupLocation: { type: "Point", coordinates: [longitude, latitude] },
      status: "requested",
    });

    await lorry.save();
    await lorry.populate("cargoBookings.shop", "name shopNumber phone address market");

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

    // The lorry rent is a completed deal once the crop is actually
    // delivered — log the platform's 5% commission (flat fee under LKR 1000).
    if (status === "delivered" && booking.calculatedRentLkr) {
      await logCommission({ source: "logistics_booking", refId: lorry._id, farmer: booking.farmer, amountLkr: booking.calculatedRentLkr });
    }

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
  toggleAcceptingCargo,
  getNearbyLorries,
  getMyLorry,
  requestCargo,
  updateCargoBooking,
  getShopsByMarket,
  getPricingConfig,
  updatePricingConfig,
  getRentQuote,
  getMyCargoBookings,
};
