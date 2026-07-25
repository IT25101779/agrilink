const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["farmer", "driver", "buyer", "admin"],
      required: true,
      default: "farmer",
    },
    preferredLanguage: {
      type: String,
      enum: ["si", "ta", "en"],
      default: "en",
    },
    // Farmer-specific profile
    farmerProfile: {
      district: { type: String },
      landSizeAcres: { type: Number },
      soilType: {
        type: String,
        enum: ["loamy", "clay", "sandy", "silty", "peaty", "chalky", "unknown"],
      },
      gpsLocation: {
        type: { type: String, enum: ["Point"], default: "Point" },
        coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
      },
      creditScore: { type: Number, default: 500, min: 0, max: 1000 },
      completedTimelinesCount: { type: Number, default: 0 },
    },
    // Driver-specific profile
    driverProfile: {
      vehicleRegistrationNo: { type: String },
      vehicleCapacityKg: { type: Number },
      isOnDuty: { type: Boolean, default: false },
    },
    // Buyer-specific profile
    buyerProfile: {
      companyName: { type: String },
      buyerType: {
        type: String,
        enum: ["supermarket", "hotel", "exporter", "factory", "restaurant", "compost_hub"],
      },
      verifiedBusiness: { type: Boolean, default: false },
    },
    isActive: { type: Boolean, default: true },
    resetPasswordOtpHash: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

UserSchema.index({ "farmerProfile.gpsLocation": "2dsphere" });
UserSchema.index({ email: 1 }, { unique: true });

UserSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

UserSchema.statics.hashPassword = function (plainPassword) {
  return bcrypt.hash(plainPassword, 10);
};

module.exports = mongoose.model("User", UserSchema);
