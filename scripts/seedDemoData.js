/**
 * Seeds a complete, believable DEMO dataset so every headline feature of
 * AgriLink AI can be shown live at the semi-finals without waiting for
 * real users:
 *
 *   - Demo accounts (farmer, buyer/investor) you can log in with
 *   - A regional Late Blight OUTBREAK near Kandy (Outbreak Radar fires)
 *   - Sold listings over the past 2 months (AI Price Prediction has real
 *     history; the Admin "Gross Marketplace Value" is no longer LKR 0)
 *   - A primary listing, a REJECTED->secondary (flash-sale) listing with
 *     its 20% markdown, and a reserved order (Marketplace + Reject flow)
 *   - Two crowdfunding campaigns (one 60% funded, one fully funded)
 *
 * SAFE TO RE-RUN: it first deletes everything it created before (data tied
 * to the two demo accounts) and then recreates it fresh. It never touches
 * real users' data.
 *
 * Run from the backend folder with:   node scripts/seedDemoData.js
 * (needs MONGO_URI in your .env — the same database the live app uses)
 *
 * Demo logins (change with DEMO_PASSWORD in .env if you like):
 *   Farmer : demo.farmer@agrilink.lk  / Demo@1234
 *   Buyer  : demo.buyer@agrilink.lk   / Demo@1234
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const MarketplaceListing = require("../models/MarketplaceListing");
const DiseaseLog = require("../models/DiseaseLog");
const CrowdfundingCampaign = require("../models/CrowdfundingCampaign");

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "Demo@1234";
const FARMER_EMAIL = "demo.farmer@agrilink.lk";
const BUYER_EMAIL = "demo.buyer@agrilink.lk";

// Kandy — the app's default fallback GPS position, so the Outbreak Radar
// shows the outbreak even on a phone with location turned off.
const KANDY = { lng: 80.6337, lat: 7.2906 };

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const daysFromNow = (n) => new Date(Date.now() + n * DAY);

async function upsertUser(doc) {
  const passwordHash = await User.hashPassword(DEMO_PASSWORD);
  await User.deleteOne({ email: doc.email });
  return User.create({ ...doc, passwordHash });
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env file.");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB.");

  // ---- 1. Clean out a previous run ----
  const previous = await User.find({ email: { $in: [FARMER_EMAIL, BUYER_EMAIL] } }).select("_id");
  const previousIds = previous.map((u) => u._id);
  if (previousIds.length) {
    await MarketplaceListing.deleteMany({ $or: [{ farmer: { $in: previousIds } }, { orderedBy: { $in: previousIds } }] });
    await DiseaseLog.deleteMany({ farmer: { $in: previousIds } });
    await CrowdfundingCampaign.deleteMany({ farmer: { $in: previousIds } });
    console.log("Removed previous demo data.");
  }

  // ---- 2. Demo accounts ----
  const farmer = await upsertUser({
    fullName: "Nimal Perera (Demo Farmer)",
    email: FARMER_EMAIL,
    phone: "+94771234567",
    role: "farmer",
    farmerProfile: {
      district: "Kandy",
      landSizeAcres: 2.5,
      soilType: "loamy",
      gpsLocation: { type: "Point", coordinates: [KANDY.lng, KANDY.lat] },
      creditScore: 640,
      completedTimelinesCount: 2,
    },
  });
  const buyer = await upsertUser({
    fullName: "Green Basket Hotels (Demo Buyer)",
    email: BUYER_EMAIL,
    phone: "+94112345678",
    role: "buyer",
    buyerProfile: { companyName: "Green Basket Hotels", buyerType: "hotel", verifiedBusiness: true },
  });
  console.log("Created demo farmer and buyer.");

  // ---- 3. Late Blight outbreak cluster around Kandy (6 reports, well over the 5-report threshold) ----
  const outbreakOffsets = [
    [0.000, 0.000], [0.020, 0.010], [-0.018, 0.015], [0.012, -0.022], [-0.025, -0.010], [0.030, 0.020],
  ];
  const treatment = JSON.stringify({
    chemical: ["Spray a copper-based fungicide (e.g. copper oxychloride) every 7 days."],
    biological: ["Remove and burn infected leaves. Improve air flow between plants."],
    prevention: ["Avoid overhead watering. Rotate crops next season."],
  });
  await DiseaseLog.insertMany(
    outbreakOffsets.map(([dLng, dLat], i) => ({
      farmer: farmer._id,
      cropType: "Tomato",
      imageUrl: "seed_demo",
      detectedDisease: "Late blight",
      confidenceScore: 0.82 + i * 0.02,
      location: { type: "Point", coordinates: [KANDY.lng + dLng, KANDY.lat + dLat] },
      district: "Kandy",
      recommendedTreatment: treatment,
      isPartOfOutbreakAlert: true,
      createdAt: daysAgo(i + 1),
      updatedAt: daysAgo(i + 1),
    }))
  );
  console.log("Created Late Blight outbreak cluster (6 reports near Kandy).");

  // ---- 4. Sold history -> price prediction + admin revenue ----
  const soldHistory = [
    // [cropType, kg, pricePerKg, days ago]
    ["Tomato", 300, 165, 55], ["Tomato", 250, 172, 42], ["Tomato", 400, 158, 30], ["Tomato", 350, 181, 18], ["Tomato", 300, 190, 7],
    ["Carrot", 200, 210, 50], ["Carrot", 260, 225, 33], ["Carrot", 180, 240, 14],
    ["Beans", 150, 320, 45], ["Beans", 170, 345, 26], ["Beans", 120, 360, 9],
    ["Pumpkin", 500, 90, 38], ["Pumpkin", 420, 95, 12],
  ];
  await MarketplaceListing.insertMany(
    soldHistory.map(([cropType, kg, price, ago]) => ({
      farmer: farmer._id,
      cropType,
      quantityKg: kg,
      originalPricePerKg: price,
      currentPricePerKg: price,
      harvestDate: daysAgo(ago + 2),
      qualityGrade: "A",
      tier: "primary",
      targetBuyerSegment: ["supermarket", "hotel", "exporter"],
      status: "sold",
      orderedBy: buyer._id,
      soldAt: daysAgo(ago),
      createdAt: daysAgo(ago + 3),
      updatedAt: daysAgo(ago),
    }))
  );

  // ---- 5. Live marketplace: primary, rejected->secondary, reserved ----
  await MarketplaceListing.create({
    farmer: farmer._id, cropType: "Tomato", quantityKg: 320, originalPricePerKg: 195, currentPricePerKg: 195,
    harvestDate: daysFromNow(1), qualityGrade: "A", tier: "primary", status: "listed",
    targetBuyerSegment: ["supermarket", "hotel", "exporter"],
  });
  await MarketplaceListing.create({
    farmer: farmer._id, cropType: "Brinjal", quantityKg: 180, originalPricePerKg: 140, currentPricePerKg: 140,
    harvestDate: daysFromNow(2), qualityGrade: "B", tier: "primary", status: "listed",
    targetBuyerSegment: ["supermarket", "hotel", "exporter"],
  });
  // A listing a hotel rejected: automatically marked down 20% and moved to the flash-sale tier.
  await MarketplaceListing.create({
    farmer: farmer._id, cropType: "Carrot", quantityKg: 240, originalPricePerKg: 230, currentPricePerKg: 184,
    markdownPercentApplied: 20, harvestDate: daysAgo(1), qualityGrade: "B", tier: "secondary", status: "listed",
    targetBuyerSegment: ["factory", "restaurant", "compost_hub"],
    rejectionHistory: [{ rejectedBy: buyer._id, reason: "Slight size variation, not suitable for hotel plating", defectType: "size_mismatch", rejectedAt: daysAgo(1) }],
  });
  await MarketplaceListing.create({
    farmer: farmer._id, cropType: "Beans", quantityKg: 90, originalPricePerKg: 350, currentPricePerKg: 350,
    harvestDate: daysAgo(0), qualityGrade: "A", tier: "primary", status: "reserved", orderedBy: buyer._id,
    targetBuyerSegment: ["supermarket", "hotel", "exporter"],
  });
  console.log("Created sold history + live marketplace listings.");

  // ---- 6. Crowdfunding ----
  await CrowdfundingCampaign.create({
    farmer: farmer._id, timelineRef: "demo-timeline-tomato", cropType: "Tomato",
    description: "Funding for drip irrigation and certified seed for a 1-acre tomato plot.",
    fundingGoalLkr: 150000, amountRaisedLkr: 90000, returnPercentage: 12, deadline: daysFromNow(40), status: "open",
    pledges: [
      { investor: buyer._id, amountLkr: 60000, expectedReturnLkr: 67200, status: "pledged", pledgedAt: daysAgo(5) },
      { investor: buyer._id, amountLkr: 30000, expectedReturnLkr: 33600, status: "pledged", pledgedAt: daysAgo(2) },
    ],
  });
  await CrowdfundingCampaign.create({
    farmer: farmer._id, timelineRef: "demo-timeline-beans", cropType: "Beans",
    description: "Trellis poles and organic fertilizer for a bean crop.",
    fundingGoalLkr: 50000, amountRaisedLkr: 50000, returnPercentage: 10, deadline: daysFromNow(25), status: "funded",
    pledges: [{ investor: buyer._id, amountLkr: 50000, expectedReturnLkr: 55000, status: "pledged", pledgedAt: daysAgo(3) }],
  });
  console.log("Created 2 crowdfunding campaigns.");

  console.log("\nDONE. Demo logins:");
  console.log(`  Farmer : ${FARMER_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Buyer  : ${BUYER_EMAIL} / ${DEMO_PASSWORD}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Seeding failed:", err.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
