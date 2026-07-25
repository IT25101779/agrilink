const LocalSupplier = require("../models/LocalSupplier");

/**
 * GET /api/suppliers/nearby?latitude=X&longitude=Y&radiusKm=25&type=seed_store
 * Public — farmer app calls this to find nearby stores/rentals.
 * type is optional; omit to get all supplier types in range.
 */
async function getNearbySuppliers(req, res) {
  try {
    const { latitude, longitude, radiusKm, type } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: "latitude and longitude are required." });
    }

    const radiusMeters = radiusKm ? Number(radiusKm) * 1000 : 25000;
    const filter = {
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [Number(longitude), Number(latitude)] },
          $maxDistance: radiusMeters,
        },
      },
    };
    if (type) filter.supplierType = type;

    const suppliers = await LocalSupplier.find(filter).limit(30);
    return res.status(200).json({ success: true, count: suppliers.length, data: suppliers });
  } catch (error) {
    console.error("getNearbySuppliers error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch nearby suppliers.", error: error.message });
  }
}

/**
 * POST /api/suppliers
 * Admin-only — add a new verified supplier/rental company.
 */
async function createSupplier(req, res) {
  try {
    const { businessName, supplierType, latitude, longitude, address, district, contactPhone, itemsAvailable, rentalEquipment, isVerified } = req.body;

    if (!businessName || !supplierType || latitude === undefined || longitude === undefined || !address || !district || !contactPhone) {
      return res.status(400).json({
        success: false,
        message: "businessName, supplierType, latitude, longitude, address, district, and contactPhone are required.",
      });
    }

    const supplier = await LocalSupplier.create({
      businessName,
      supplierType,
      location: { type: "Point", coordinates: [longitude, latitude] },
      address,
      district,
      contactPhone,
      itemsAvailable: itemsAvailable || [],
      rentalEquipment: rentalEquipment || [],
      isVerified: !!isVerified,
      createdBy: req.userId,
    });

    return res.status(201).json({ success: true, data: supplier });
  } catch (error) {
    console.error("createSupplier error:", error);
    return res.status(500).json({ success: false, message: "Failed to create supplier.", error: error.message });
  }
}

/**
 * GET /api/suppliers
 * Admin oversight — all suppliers, unfiltered by location.
 */
async function getAllSuppliers(req, res) {
  try {
    const suppliers = await LocalSupplier.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: suppliers.length, data: suppliers });
  } catch (error) {
    console.error("getAllSuppliers error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch suppliers.", error: error.message });
  }
}

/**
 * PATCH /api/suppliers/:id
 */
async function updateSupplier(req, res) {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    if (updates.latitude !== undefined && updates.longitude !== undefined) {
      updates.location = { type: "Point", coordinates: [updates.longitude, updates.latitude] };
      delete updates.latitude;
      delete updates.longitude;
    }

    const supplier = await LocalSupplier.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
    if (!supplier) {
      return res.status(404).json({ success: false, message: "Supplier not found." });
    }
    return res.status(200).json({ success: true, data: supplier });
  } catch (error) {
    console.error("updateSupplier error:", error);
    return res.status(500).json({ success: false, message: "Failed to update supplier.", error: error.message });
  }
}

/**
 * DELETE /api/suppliers/:id
 */
async function deleteSupplier(req, res) {
  try {
    const { id } = req.params;
    const supplier = await LocalSupplier.findByIdAndDelete(id);
    if (!supplier) {
      return res.status(404).json({ success: false, message: "Supplier not found." });
    }
    return res.status(200).json({ success: true, message: "Supplier deleted." });
  } catch (error) {
    console.error("deleteSupplier error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete supplier.", error: error.message });
  }
}

module.exports = { getNearbySuppliers, createSupplier, getAllSuppliers, updateSupplier, deleteSupplier };
