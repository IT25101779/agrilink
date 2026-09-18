const CommunityListing = require("../models/CommunityListing");
const User = require("../models/User");

/**
 * POST /api/community-listings
 * A farmer posts an item for rent or sale (equipment, seeds, other).
 * Body: { farmer, listingType, title, description, priceInfo: {amount, unit},
 *         latitude, longitude, district, contactPhone?, photos? }
 * contactPhone is optional — if omitted, defaults to the farmer's account
 * phone number (already collected at registration).
 */
async function createListing(req, res) {
  try {
    const { farmer, listingType, title, description, priceInfo, latitude, longitude, district, contactPhone, photos } = req.body;

    if (!farmer || !listingType || !title || !description || !priceInfo?.amount || !priceInfo?.unit || latitude === undefined || longitude === undefined || !district) {
      return res.status(400).json({
        success: false,
        message: "farmer, listingType, title, description, priceInfo (amount, unit), latitude, longitude, and district are required.",
      });
    }

    let resolvedPhone = contactPhone;
    if (!resolvedPhone) {
      const farmerUser = await User.findById(farmer).select("phone");
      resolvedPhone = farmerUser?.phone;
    }
    if (!resolvedPhone) {
      return res.status(400).json({
        success: false,
        message: "contactPhone is required (and no phone number was found on the farmer's account to default to).",
      });
    }

    const listing = await CommunityListing.create({
      farmer,
      listingType,
      title,
      description,
      priceInfo,
      location: { type: "Point", coordinates: [longitude, latitude] },
      district,
      contactPhone: resolvedPhone,
      photos: photos || [],
    });

    return res.status(201).json({ success: true, data: listing });
  } catch (error) {
    console.error("createListing (community) error:", error);
    return res.status(500).json({ success: false, message: "Failed to create listing.", error: error.message });
  }
}

/**
 * GET /api/community-listings/nearby?latitude=X&longitude=Y&radiusKm=25&listingType=equipment_rental
 * Public browse — buyers looking for equipment to rent or seeds to buy
 * near them. Same pattern as GET /api/suppliers/nearby.
 */
async function getNearbyListings(req, res) {
  try {
    const { latitude, longitude, radiusKm, listingType } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: "latitude and longitude are required." });
    }

    const radiusMeters = radiusKm ? Number(radiusKm) * 1000 : 25000;
    const filter = {
      isActive: true,
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [Number(longitude), Number(latitude)] },
          $maxDistance: radiusMeters,
        },
      },
    };
    if (listingType) filter.listingType = listingType;

    const listings = await CommunityListing.find(filter).populate("farmer", "fullName").limit(50);
    return res.status(200).json({ success: true, count: listings.length, data: listings });
  } catch (error) {
    console.error("getNearbyListings error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch nearby listings.", error: error.message });
  }
}

/**
 * GET /api/community-listings/mine?farmerId=X
 * A farmer's own posted listings (active and inactive), for a "My Rentals
 * & Seeds" management screen.
 */
async function getMyListings(req, res) {
  try {
    const { farmerId } = req.query;
    if (!farmerId) {
      return res.status(400).json({ success: false, message: "farmerId is required." });
    }
    const listings = await CommunityListing.find({ farmer: farmerId }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: listings });
  } catch (error) {
    console.error("getMyListings (community) error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch your listings.", error: error.message });
  }
}

/**
 * PATCH /api/community-listings/:id
 * Farmer edits their own posting (price, description, active/inactive
 * toggle, etc). Body must include farmerId to verify ownership, same
 * pattern as marketplaceController.updateListing.
 */
async function updateListing(req, res) {
  try {
    const { id } = req.params;
    const { farmerId, title, description, priceInfo, isActive, contactPhone, photos, latitude, longitude, district } = req.body;

    if (!farmerId) {
      return res.status(400).json({ success: false, message: "farmerId is required to verify ownership." });
    }

    const listing = await CommunityListing.findById(id);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }
    if (listing.farmer.toString() !== farmerId) {
      return res.status(403).json({ success: false, message: "You can only edit your own listings." });
    }

    if (title !== undefined) listing.title = title;
    if (description !== undefined) listing.description = description;
    if (priceInfo !== undefined) listing.priceInfo = priceInfo;
    if (isActive !== undefined) listing.isActive = isActive;
    if (contactPhone !== undefined) listing.contactPhone = contactPhone;
    if (photos !== undefined) listing.photos = photos;
    if (district !== undefined) listing.district = district;
    if (latitude !== undefined && longitude !== undefined) {
      listing.location = { type: "Point", coordinates: [longitude, latitude] };
    }

    await listing.save();
    return res.status(200).json({ success: true, data: listing });
  } catch (error) {
    console.error("updateListing (community) error:", error);
    return res.status(500).json({ success: false, message: "Failed to update listing.", error: error.message });
  }
}

/**
 * DELETE /api/community-listings/:id
 * Body: { farmerId } to verify ownership (query param also accepted for
 * convenience, since some HTTP clients handle DELETE bodies awkwardly).
 */
async function deleteListing(req, res) {
  try {
    const { id } = req.params;
    const farmerId = req.body?.farmerId || req.query?.farmerId;

    if (!farmerId) {
      return res.status(400).json({ success: false, message: "farmerId is required to verify ownership." });
    }

    const listing = await CommunityListing.findById(id);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }
    if (listing.farmer.toString() !== farmerId) {
      return res.status(403).json({ success: false, message: "You can only delete your own listings." });
    }

    await listing.deleteOne();
    return res.status(200).json({ success: true, message: "Listing deleted." });
  } catch (error) {
    console.error("deleteListing (community) error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete listing.", error: error.message });
  }
}

/**
 * GET /api/community-listings
 * Admin oversight — every posting, unfiltered by location, so admin can
 * moderate/remove inappropriate listings. Mirrors supplierController's
 * getAllSuppliers pattern.
 */
async function getAllListings(req, res) {
  try {
    const listings = await CommunityListing.find().populate("farmer", "fullName phone").sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: listings.length, data: listings });
  } catch (error) {
    console.error("getAllListings (community) error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch listings.", error: error.message });
  }
}

/**
 * DELETE /api/community-listings/:id/admin
 * Admin-only removal, no ownership check — for moderating inappropriate
 * or spam postings.
 */
async function adminDeleteListing(req, res) {
  try {
    const { id } = req.params;
    const listing = await CommunityListing.findByIdAndDelete(id);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }
    return res.status(200).json({ success: true, message: "Listing removed by admin." });
  } catch (error) {
    console.error("adminDeleteListing error:", error);
    return res.status(500).json({ success: false, message: "Failed to remove listing.", error: error.message });
  }
}

module.exports = {
  createListing,
  getNearbyListings,
  getMyListings,
  updateListing,
  deleteListing,
  getAllListings,
  adminDeleteListing,
};
