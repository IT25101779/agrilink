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
    cargoBookings: {
      type: [
        {
          farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          listingRef: { type: mongoose.Schema.Types.ObjectId, ref: "MarketplaceListing" },
          weightKg: { type: Number },
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
