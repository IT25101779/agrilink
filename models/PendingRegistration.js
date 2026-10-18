const mongoose = require("mongoose");

/**
 * Holds a registration's details WHILE waiting for the person to confirm
 * the OTP code sent to their email — no real User account exists yet, so
 * a fake email can never create (even a disabled) account on this server.
 *
 * This is deliberately short-lived: a TTL index wipes it automatically
 * after 1 hour even if the person never comes back to enter the code, so
 * these never pile up.
 */
const PendingRegistrationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["farmer", "driver", "buyer", "admin"], required: true },
    farmerProfile: { type: mongoose.Schema.Types.Mixed },
    buyerProfile: { type: mongoose.Schema.Types.Mixed },
    driverProfile: { type: mongoose.Schema.Types.Mixed },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    otpHash: { type: String, required: true },
    otpExpires: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: Date.now },
    // TTL: Mongo deletes the document automatically once this time passes,
    // independent of otpExpires (which only blocks a late OTP from working;
    // this is what actually cleans the collection up).
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PendingRegistration", PendingRegistrationSchema);
