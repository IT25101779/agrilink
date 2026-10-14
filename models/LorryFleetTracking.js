const mongoose = require("mongoose");

const LorryFleetTrackingSchema = new mongoose.Schema(
  {
    driver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    vehicleRegistrationNo: { type: String, required: true },
    totalCapacityKg: { type: Number, required: true },
    remainingCapacityKg: { type: Number, required: true },
    currentLocation: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    destinationHub: {
      type: String,
      enum: ["Dambulla", "Colombo_Manning_Market", "Pettah", "Kandy", "Jaffna", "Other"],
      required: true,
    },
    isTrackingActive: { type: Boolean, default: false },
    // Separate from isTrackingActive: the driver can be visible/tracked but
    // say "I'm full, stop sending me requests" without going fully offline.
    // Request a user asked for directly: "when the lorry fulled the driver
    // should be able to update as fulled and not getting crops any more."
    acceptingCargo: { type: Boolean, default: true },
    cargoBookings: {
      type: [
        {
          farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          listingRef: { type: mongoose.Schema.Types.ObjectId, ref: "MarketplaceListing" },
          cropType: { type: String },
          weightKg: { type: Number },
          // Which shop at the destination market the farmer chose to sell/drop to.
          shop: { type: mongoose.Schema.Types.ObjectId, ref: "MarketShop" },
          // Rent calculated at request time from the admin-set tiered rate —
          // stored so it never silently changes after the farmer agreed to it.
          calculatedRentLkr: { type: Number },
          pickupLocation: {
            type: { type: String, enum: ["Point"], default: "Point" },
            coordinates: { type: [Number] },
          },
          status: {
            type: String,
            enum: ["requested", "confirmed", "picked_up", "delivered", "cancelled"],
            default: "requested",
          },
        },
      ],
      default: [],
    },
    routeStatus: {
      type: String,
      enum: ["idle", "en_route", "loading", "delivered"],
      default: "idle",
    },
  },
  { timestamps: true }
);

LorryFleetTrackingSchema.index({ currentLocation: "2dsphere" });
LorryFleetTrackingSchema.index({ isTrackingActive: 1, destinationHub: 1 });

module.exports = mongoose.model("LorryFleetTracking", LorryFleetTrackingSchema);
