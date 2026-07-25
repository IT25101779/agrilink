/**
 * Seeds sample local suppliers (seed/fertilizer/tool stores + equipment
 * rental companies) across several Sri Lankan districts so the "Nearby
 * Suppliers & Rentals" feature is demoable immediately, without needing
 * to manually add data through the Admin panel first.
 *
 * Run with: node scripts/seedSuppliers.js
 * (requires your .env MONGO_URI to already be set up)
 */
require("dotenv").config();
const mongoose = require("mongoose");
const LocalSupplier = require("../models/LocalSupplier");

const sampleSuppliers = [
  {
    businessName: "Kurunegala Agro Center",
    supplierType: "seed_store",
    location: { type: "Point", coordinates: [80.3647, 7.4863] },
    address: "No. 45, Kandy Road, Kurunegala",
    district: "Kurunegala",
    contactPhone: "+94372223344",
    isVerified: true,
    itemsAvailable: ["tomato seeds", "chili seeds", "paddy seeds", "urea fertilizer", "compost"],
  },
  {
    businessName: "Dambulla Farmers Supply",
    supplierType: "fertilizer_store",
    location: { type: "Point", coordinates: [80.6517, 7.8675] },
    address: "Anuradhapura Road, Dambulla",
    district: "Matale",
    contactPhone: "+94662284455",
    isVerified: true,
    itemsAvailable: ["urea", "TSP", "MOP", "organic compost", "pesticides"],
  },
  {
    businessName: "Kandy Garden Tools",
    supplierType: "tool_store",
    location: { type: "Point", coordinates: [80.6337, 7.2906] },
    address: "Peradeniya Road, Kandy",
    district: "Kandy",
    contactPhone: "+94812234455",
    isVerified: true,
    itemsAvailable: ["sprayers", "hoes", "sickles", "irrigation pipes", "protective gloves"],
  },
  {
    businessName: "Anuradhapura Tractor Rentals",
    supplierType: "equipment_rental",
    location: { type: "Point", coordinates: [80.4037, 8.3114] },
    address: "Maithreepala Mawatha, Anuradhapura",
    district: "Anuradhapura",
    contactPhone: "+94252235566",
    isVerified: true,
    rentalEquipment: [
      { equipmentName: "Two-wheel tractor", dailyRateLkr: 4500 },
      { equipmentName: "Four-wheel tractor", dailyRateLkr: 9000 },
      { equipmentName: "Combine harvester", dailyRateLkr: 22000 },
    ],
  },
  {
    businessName: "Galle Southern Machinery",
    supplierType: "equipment_rental",
    location: { type: "Point", coordinates: [80.2170, 6.0535] },
    address: "Matara Road, Galle",
    district: "Galle",
    contactPhone: "+94912246677",
    isVerified: true,
    rentalEquipment: [
      { equipmentName: "Two-wheel tractor", dailyRateLkr: 4000 },
      { equipmentName: "Water pump", dailyRateLkr: 1500 },
      { equipmentName: "Brush cutter", dailyRateLkr: 1200 },
    ],
  },
  {
    businessName: "Colombo Agri Mart",
    supplierType: "seed_store",
    location: { type: "Point", coordinates: [79.8612, 6.9271] },
    address: "Baseline Road, Colombo 09",
    district: "Colombo",
    contactPhone: "+94112257788",
    isVerified: true,
    itemsAvailable: ["hybrid vegetable seeds", "greenhouse supplies", "drip irrigation kits"],
  },
  {
    businessName: "Matara Green Fertilizers",
    supplierType: "fertilizer_store",
    location: { type: "Point", coordinates: [80.5353, 5.9485] },
    address: "Akuressa Road, Matara",
    district: "Matara",
    contactPhone: "+94412268899",
    isVerified: false,
    itemsAvailable: ["organic fertilizer", "foliar spray", "lime"],
  },
  {
    businessName: "Jaffna Northern Agro Supplies",
    supplierType: "tool_store",
    location: { type: "Point", coordinates: [80.0255, 9.6615] },
    address: "Hospital Road, Jaffna",
    district: "Jaffna",
    contactPhone: "+94212279900",
    isVerified: true,
    itemsAvailable: ["hand tools", "sprayers", "nets", "storage crates"],
  },
  {
    businessName: "Ratnapura Hill Country Rentals",
    supplierType: "equipment_rental",
    location: { type: "Point", coordinates: [80.4037, 6.6828] },
    address: "Pelmadulla Road, Ratnapura",
    district: "Ratnapura",
    contactPhone: "+94452281122",
    isVerified: true,
    rentalEquipment: [
      { equipmentName: "Mini tiller", dailyRateLkr: 3000 },
      { equipmentName: "Two-wheel tractor", dailyRateLkr: 4200 },
    ],
  },
  {
    businessName: "Badulla Upcountry Farm Store",
    supplierType: "seed_store",
    location: { type: "Point", coordinates: [81.0550, 6.9934] },
    address: "Bandarawela Road, Badulla",
    district: "Badulla",
    contactPhone: "+94552292233",
    isVerified: true,
    itemsAvailable: ["vegetable seeds", "potato seed tubers", "fertilizer", "greenhouse film"],
  },
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB. Seeding suppliers...");

  let created = 0;
  for (const supplier of sampleSuppliers) {
    const exists = await LocalSupplier.findOne({ businessName: supplier.businessName });
    if (!exists) {
      await LocalSupplier.create(supplier);
      created++;
    }
  }

  console.log(`Done. Created ${created} new supplier(s) (skipped any that already existed).`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
