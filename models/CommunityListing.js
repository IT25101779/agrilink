const mongoose = require("mongoose");

/**
 * Farmer-to-farmer/buyer marketplace for equipment rentals and seeds/
 * inputs for sale — distinct from LocalSupplier (which is admin-managed
 * businesses like agro-stores) and MarketplaceListing (which is harvested
 * produce). This is what a farmer posts themselves: "I have a tiller for
 * rent," "I have extra tomato seeds to sell."
 *
 * No in-app purchase flow by design, matching the actual request this
 * was built for: a buyer sees the listing and calls contactPhone
 * directly — the farmer handles the transaction themselves, same pattern
 * as the existing Suppliers screen's "Call" button.
 */
const CommunityListingSchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    listingType: {
      type: String,
      enum: ["equipment_rental", "seeds_for_sale", "other"],
      required: true,
    },
    title: { type: String, required: true }, // e.g. "Two-wheel tractor for rent"
    description: { type: String, required: true },
    priceInfo: {
      amount: { type: Number, required: true },
      // Free-text unit rather than a strict enum, since rentals and sales
      // price very differently ("per day", "per acre", "per kg", "fixed price")
      unit: { type: String, required: true },
    },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    district: { type: String, required: true },
    // Denormalized copy of the farmer's phone number at post time (not a
    // live reference) so a listing still shows a working contact number
    // even if the farmer later changes their account phone, and so the
    // farmer can list a different contact number for this item than
    // their account phone if they want to (e.g. a shared family phone).
    contactPhone: { type: String, required: true },
    photos: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

CommunityListingSchema.index({ location: "2dsphere" });
CommunityListingSchema.index({ listingType: 1, isActive: 1, district: 1 });
CommunityListingSchema.index({ farmer: 1 });

module.exports = mongoose.model("CommunityListing", CommunityListingSchema);
