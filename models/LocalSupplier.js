const mongoose = require("mongoose");

const LocalSupplierSchema = new mongoose.Schema(
  {
    businessName: { type: String, required: true },
    supplierType: {
      type: String,
      enum: ["seed_store", "fertilizer_store", "tool_store", "equipment_rental"],
      required: true,
    },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    address: { type: String, required: true },
    district: { type: String, required: true },
    contactPhone: { type: String, required: true },
    isVerified: { type: Boolean, default: false },

    // Relevant for seed/fertilizer/tool stores
    itemsAvailable: { type: [String], default: [] }, // e.g. ["tomato seeds", "urea fertilizer", "sprayers"]

    // Relevant for equipment_rental type
    rentalEquipment: {
      type: [
        {
          equipmentName: { type: String }, // e.g. "Two-wheel tractor", "Combine harvester"
          dailyRateLkr: { type: Number },
        },
      ],
      default: [],
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

LocalSupplierSchema.index({ location: "2dsphere" });
LocalSupplierSchema.index({ supplierType: 1, district: 1 });

module.exports = mongoose.model("LocalSupplier", LocalSupplierSchema);
