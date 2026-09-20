const mongoose = require("mongoose");

/** A truck driver's empty return journey, offered to farmers at a lower price. */
const ReturnTripSchema = new mongoose.Schema(
  {
    driver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    vehicleRegistrationNo: { type: String, default: "" },
    fromHub: { type: String, enum: ["Dambulla", "Colombo_Manning_Market", "Pettah", "Kandy", "Jaffna", "Other"], required: true },
    toDistrict: { type: String, required: true },
    departAt: { type: Date, required: true },
    availableKg: { type: Number, required: true, min: 1 },
    pricePerKg: { type: Number, required: true, min: 0 }, // LKR per kg for this trip
    regularPricePerKg: { type: Number, min: 0 }, // what the driver normally charges — shows the saving
    note: { type: String, default: "", maxlength: 200 },
    status: { type: String, enum: ["open", "cancelled", "departed"], default: "open" },
    bookings: {
      type: [
        {
          farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
          weightKg: { type: Number, required: true },
          cropType: { type: String, default: "" },
          status: { type: String, enum: ["requested", "confirmed", "rejected", "cancelled"], default: "requested" },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

ReturnTripSchema.index({ status: 1, departAt: 1, toDistrict: 1 });

module.exports = mongoose.model("ReturnTrip", ReturnTripSchema);
