const mongoose = require("mongoose");
const crypto = require("crypto");

/**
 * DATA-AS-A-SERVICE — a SECOND revenue line, separate from the 5% deal
 * commission. The platform already collects district-level yield, price
 * and demand data from real usage. Anonymized AGGREGATES of that (never
 * any individual farmer's name or raw record) can be licensed to seed/
 * fertilizer companies, insurers, or government planning bodies.
 *
 * An admin (developer) creates a partner here, which mints an API key.
 * The partner's own system calls the read-only /api/partner-insights/*
 * endpoints with that key — no AgriLink user login involved, since the
 * partner is an organization, not a farmer/buyer account.
 *
 * monthlyFeeLkr is recorded for the admin's own bookkeeping only — it is
 * billed and paid OFFLINE (invoice / bank transfer), same no-online-
 * payments rule as the rest of the platform.
 */
const DataPartnerSchema = new mongoose.Schema(
  {
    orgName: { type: String, required: true, trim: true, maxlength: 100 },
    contactEmail: { type: String, trim: true, default: "" },
    contactPhone: { type: String, trim: true, default: "" },
    apiKey: { type: String, required: true, unique: true, default: () => crypto.randomBytes(24).toString("hex") },
    monthlyFeeLkr: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    lastUsedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DataPartner", DataPartnerSchema);
