/**
 * Seeds a complete, believable DEMO dataset so every headline feature of
 * AgriLink AI can be shown live without waiting for real users:
 *
 *   - Demo accounts: a farmer and a buyer/investor you can log in with
 *   - 12 "neighbour" farmers (Kandy, Matale, Nuwara Eliya) growing crops, so
 *     the OVERSUPPLY GUARD has real data (Tomato is crowded in Kandy)
 *   - A Late Blight OUTBREAK near Kandy (Outbreak Radar fires)
 *   - Sold-price history over ~2 months (price forecast + SELL-OR-HOLD trend)
 *   - Produce at different FRESHNESS stages (fresh, aging, expired) and a
 *     rejected-then-discounted flash-sale listing
 *   - GROUP LOTS: one nearly full, one completely full (ready for a buyer to
 *     claim), one just started
 *   - BUYER DEMAND BOARD: three open buyer requests, one with a farmer offer
 *   - Crowdfunding campaigns (one 60% funded, one fully funded, one repaid),
 *     which feed the FARM PASSPORT
 *   - 25 more farmers across 6 more districts (Nuwara Eliya, Anuradhapura,
 *     Kurunegala, Badulla, Jaffna, Galle) so the admin MARKET HEATMAP has
 *     hotspots and quiet districts to show
 *   - Produce rescued from waste (rejected, then sold on the flash-sale
 *     market), one completed group sale and one fulfilled buyer request, so
 *     the admin IMPACT DASHBOARD has real numbers to add up
 *   - A demo farmer whose account is 120 days old, so the LOAN READINESS
 *     checklist shows 7 of 8 checks (the last one, a group sale, is what you
 *     complete live in the demo)
 *
 * SAFE TO RE-RUN: it first deletes everything it created before (data tied
 * to the demo accounts) and recreates it fresh. It never touches real
 * users' data.
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
const CultivationTimeline = require("../models/CultivationTimeline");
const GroupLot = require("../models/GroupLot");
const DemandRequest = require("../models/DemandRequest");
const Reminder = require("../models/Reminder");

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "Demo@1234";
const FARMER_EMAIL = "demo.farmer@agrilink.lk";
const BUYER_EMAIL = "demo.buyer@agrilink.lk";
const NEIGHBOUR_DOMAIN = "@neighbour.demo.agrilink.lk";

// Kandy — the app's default fallback GPS position, so the Outbreak Radar
// shows the outbreak even on a phone with location turned off.
const KANDY = { lng: 80.6337, lat: 7.2906 };

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const daysFromNow = (n) => new Date(Date.now() + n * DAY);

// [full name, district, crops they are growing now]
// Kandy: Tomato x7 (crowded!), Beans (Bush) x3, Carrot x2, Pumpkin, Brinjal, Cabbage
const NEIGHBOURS = [
  ["Sunil Bandara", "Kandy", ["Tomato", "Beans (Bush)"]],
  ["Kamala Rathnayake", "Kandy", ["Tomato", "Beans (Bush)"]],
  ["Lasantha Fernando", "Kandy", ["Tomato", "Beans (Bush)"]],
  ["Malini Wickramasinghe", "Kandy", ["Tomato", "Carrot"]],
  ["Nuwan Dissanayake", "Kandy", ["Tomato", "Carrot"]],
  ["Priyanka Herath", "Kandy", ["Tomato", "Pumpkin"]],
  ["Ranjith Gunasekara", "Kandy", ["Tomato", "Brinjal (Eggplant)"]],
  ["Sandya Abeysekara", "Kandy", ["Cabbage"]],
  ["Thilak Jayawardena", "Matale", ["Tomato"]],
  ["Uma Senanayake", "Matale", ["Carrot"]],
  ["Vijay Kumar", "Nuwara Eliya", ["Carrot", "Cabbage"]],
  ["Wasantha Silva", "Nuwara Eliya", ["Carrot"]],
];

const CROP_DURATION_DAYS = { Tomato: 75, "Beans (Bush)": 55, Carrot: 85, Pumpkin: 100, "Brinjal (Eggplant)": 80, Cabbage: 70 };

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env file.");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB.");

  // ---- 1. Clean out a previous run ----
  const previous = await User.find({
    $or: [{ email: { $in: [FARMER_EMAIL, BUYER_EMAIL] } }, { email: { $regex: `${NEIGHBOUR_DOMAIN.replace(/\./g, "\\.")}$` } }],
  }).select("_id");
  const previousIds = previous.map((u) => u._id);
  if (previousIds.length) {
    await MarketplaceListing.deleteMany({ $or: [{ farmer: { $in: previousIds } }, { orderedBy: { $in: previousIds } }] });
    await DiseaseLog.deleteMany({ farmer: { $in: previousIds } });
    await CrowdfundingCampaign.deleteMany({ farmer: { $in: previousIds } });
    await CultivationTimeline.deleteMany({ farmer: { $in: previousIds } });
    await GroupLot.deleteMany({ createdBy: { $in: previousIds } });
    await DemandRequest.deleteMany({ buyer: { $in: previousIds } });
    await Reminder.deleteMany({ farmer: { $in: previousIds } });
    await User.deleteMany({ _id: { $in: previousIds } });
    console.log("Removed previous demo data.");
  }

  // ---- 2. Accounts ----
  const passwordHash = await User.hashPassword(DEMO_PASSWORD);

  const farmer = await User.create({
    fullName: "Nimal Perera (Demo Farmer)",
    createdAt: daysAgo(120),
    email: FARMER_EMAIL,
    phone: "+94771234567",
    passwordHash,
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
  const buyer = await User.create({
    fullName: "Green Basket Hotels (Demo Buyer)",
    email: BUYER_EMAIL,
    phone: "+94112345678",
    passwordHash,
    role: "buyer",
    buyerProfile: { companyName: "Green Basket Hotels", buyerType: "hotel", verifiedBusiness: true },
  });

  // A second buyer, so some group sales / requests are already "someone else's"
  const buyer2 = await User.create({
    fullName: "Lanka Fresh Exports (Demo Buyer 2)",
    email: `buyer2${NEIGHBOUR_DOMAIN}`,
    phone: "+94112223344",
    passwordHash,
    role: "buyer",
    buyerProfile: { companyName: "Lanka Fresh Exports", buyerType: "exporter", verifiedBusiness: true },
  });

  const neighbours = [];
  for (let i = 0; i < NEIGHBOURS.length; i++) {
    const [fullName, district] = NEIGHBOURS[i];
    neighbours.push(
      await User.create({
        fullName,
        email: `neighbour${i + 1}${NEIGHBOUR_DOMAIN}`,
        phone: `+9477${String(1000000 + i * 1111).slice(0, 7)}`,
        passwordHash,
        role: "farmer",
        farmerProfile: {
          district,
          landSizeAcres: 1 + (i % 3),
          soilType: "loamy",
          gpsLocation: { type: "Point", coordinates: [KANDY.lng + (i % 5) * 0.01, KANDY.lat + (i % 4) * 0.01] },
          creditScore: 520 + i * 15,
        },
      })
    );
  }
  console.log(`Created demo farmer, demo buyer and ${neighbours.length} neighbouring farmers.`);

  // ---- 3. Neighbours' active crops (Oversupply Guard data) ----
  let timelineCount = 0;
  for (let i = 0; i < NEIGHBOURS.length; i++) {
    const [, district, crops] = NEIGHBOURS[i];
    for (const cropType of crops) {
      const duration = CROP_DURATION_DAYS[cropType] || 80;
      const plantedDaysAgo = 10 + ((i * 7 + timelineCount * 3) % 30);
      await CultivationTimeline.create({
        farmer: neighbours[i]._id,
        cropType,
        landSizeAcres: 0.5 + (i % 3) * 0.5,
        soilType: "loamy",
        gpsLocation: { type: "Point", coordinates: [KANDY.lng + (i % 5) * 0.01, KANDY.lat + (i % 4) * 0.01] },
        plantingDate: daysAgo(plantedDaysAgo),
        expectedHarvestDate: daysFromNow(Math.max(10, duration - plantedDaysAgo)),
        status: "active",
        localId: `seed-${i + 1}-${cropType.replace(/\W/g, "").toLowerCase()}`,
        syncStatus: "synced",
      });
      timelineCount += 1;
    }
  }
  console.log(`Created ${timelineCount} active crop timelines for neighbours.`);

  // ---- 3b. More districts (feeds the admin Market Heatmap) ----
  // [district, [[crop, number of farmers growing it], ...]]
  const EXTRA_DISTRICTS = [
    ["Nuwara Eliya", [["Carrot", 5], ["Cabbage", 3], ["Leeks", 2], ["Beetroot", 2]]],
    ["Anuradhapura", [["Paddy (Rice)", 6], ["Okra (Bandakka)", 3], ["Pumpkin", 2], ["Watermelon", 2]]],
    ["Kurunegala", [["Brinjal (Eggplant)", 4], ["Okra (Bandakka)", 3], ["Beans (Bush)", 2], ["Chili", 2]]],
    ["Badulla", [["Tomato", 4], ["Beans (Bush)", 3], ["Cabbage", 2]]],
    ["Jaffna", [["Chili", 4], ["Onion (Big/Red)", 4], ["Brinjal (Eggplant)", 2]]],
    ["Galle", [["Cucumber", 2], ["Snake Gourd", 2], ["Okra (Bandakka)", 2], ["Bitter Gourd", 2]]],
  ];
  const DISTRICT_COORDS = {
    "Nuwara Eliya": [80.77, 6.97], Anuradhapura: [80.41, 8.31], Kurunegala: [80.36, 7.49],
    Badulla: [81.05, 6.99], Jaffna: [80.01, 9.66], Galle: [80.22, 6.03],
  };
  let extraFarmerCount = 0;
  let extraTimelineCount = 0;
  for (const [district, cropCounts] of EXTRA_DISTRICTS) {
    const farmersNeeded = Math.max(...cropCounts.map(([, count]) => count));
    const [lng, lat] = DISTRICT_COORDS[district];
    const created = [];
    for (let i = 0; i < farmersNeeded; i++) {
      extraFarmerCount += 1;
      created.push(
        await User.create({
          fullName: `${district} Farmer ${i + 1}`,
          email: `d${extraFarmerCount}${NEIGHBOUR_DOMAIN}`,
          phone: `+9476${String(2000000 + extraFarmerCount * 137).slice(0, 7)}`,
          passwordHash,
          role: "farmer",
          farmerProfile: {
            district, landSizeAcres: 1, soilType: "loamy",
            gpsLocation: { type: "Point", coordinates: [lng + i * 0.01, lat + i * 0.01] },
            creditScore: 540 + i * 10,
          },
        })
      );
    }
    const rows = [];
    for (const [cropType, count] of cropCounts) {
      for (let i = 0; i < count; i++) {
        const duration = CROP_DURATION_DAYS[cropType] || 80;
        const plantedDaysAgo = 8 + ((i * 5 + extraTimelineCount) % 30);
        extraTimelineCount += 1;
        rows.push({
          farmer: created[i]._id, cropType, landSizeAcres: 0.5 + (i % 3) * 0.5, soilType: "loamy",
          gpsLocation: { type: "Point", coordinates: [lng + i * 0.01, lat + i * 0.01] },
          plantingDate: daysAgo(plantedDaysAgo), expectedHarvestDate: daysFromNow(Math.max(10, duration - plantedDaysAgo)),
          status: "active", localId: `seed-x${extraTimelineCount}`, syncStatus: "synced",
        });
      }
    }
    await CultivationTimeline.insertMany(rows);
  }
  console.log(`Created ${extraFarmerCount} more farmers and ${extraTimelineCount} timelines across 6 more districts.`);

  // ---- 4. Late Blight outbreak cluster around Kandy ----
  const outbreakOffsets = [[0, 0], [0.02, 0.01], [-0.018, 0.015], [0.012, -0.022], [-0.025, -0.01], [0.03, 0.02]];
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

  // ---- 5. Sold history (price forecast + Sell-or-Hold trend + Farm Passport) ----
  // Each crop has completed sales in the last 14 days AND in the 15-45 days
  // before that, so the "price trend" signal has data on both sides.
  const soldHistory = [
    // [cropType, kg, pricePerKg, days ago]
    ["Tomato", 300, 165, 55], ["Tomato", 250, 172, 42], ["Tomato", 400, 158, 30], ["Tomato", 350, 181, 18], ["Tomato", 300, 190, 7],
    ["Carrot", 200, 210, 50], ["Carrot", 260, 225, 33], ["Carrot", 180, 240, 12],
    ["Beans (Bush)", 150, 320, 40], ["Beans (Bush)", 170, 345, 26], ["Beans (Bush)", 120, 360, 9],
    ["Pumpkin", 500, 90, 38], ["Pumpkin", 420, 95, 12],
  ];
  await MarketplaceListing.insertMany(
    soldHistory.map(([cropType, kg, price, ago]) => ({
      farmer: farmer._id,
      cropType,
      quantityKg: kg,
      originalPricePerKg: price,
      currentPricePerKg: price,
      agreedPricePerKg: price,
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

  // ---- 6. Live marketplace at different FRESHNESS stages ----
  const primarySegments = ["supermarket", "hotel", "exporter"];
  // Fresh tomatoes (1 day old) — crowded market, so Sell-or-Hold says "sell soon"
  await MarketplaceListing.create({
    farmer: farmer._id, cropType: "Tomato", quantityKg: 320, originalPricePerKg: 195, currentPricePerKg: 195,
    harvestDate: daysAgo(1), qualityGrade: "A", tier: "primary", status: "listed", targetBuyerSegment: primarySegments,
  });
  // Fresh beans (today) — prices climbing and supply not crowded, so Sell-or-Hold says "hold"
  await MarketplaceListing.create({
    farmer: farmer._id, cropType: "Beans (Bush)", quantityKg: 90, originalPricePerKg: 350, currentPricePerKg: 350,
    harvestDate: daysAgo(0.2), qualityGrade: "A", tier: "primary", status: "listed", targetBuyerSegment: primarySegments,
  });
  // Ageing brinjal (4 of 6 days used) — price is already sliding with freshness
  await MarketplaceListing.create({
    farmer: farmer._id, cropType: "Brinjal (Eggplant)", quantityKg: 180, originalPricePerKg: 140, currentPricePerKg: 140,
    harvestDate: daysAgo(4), qualityGrade: "B", tier: "primary", status: "listed", targetBuyerSegment: primarySegments,
  });
  // Expired okra (6 days old, window is 4) — urgent, can't be bought as fresh primary stock
  await MarketplaceListing.create({
    farmer: farmer._id, cropType: "Okra (Bandakka)", quantityKg: 60, originalPricePerKg: 260, currentPricePerKg: 260,
    harvestDate: daysAgo(6), qualityGrade: "B", tier: "primary", status: "listed", targetBuyerSegment: primarySegments,
  });
  // A listing a hotel rejected: automatically marked down 20% and moved to the flash-sale tier.
  await MarketplaceListing.create({
    farmer: farmer._id, cropType: "Carrot", quantityKg: 240, originalPricePerKg: 230, currentPricePerKg: 184,
    markdownPercentApplied: 20, harvestDate: daysAgo(1), qualityGrade: "B", tier: "secondary", status: "listed",
    targetBuyerSegment: ["factory", "restaurant", "compost_hub"],
    rejectionHistory: [{ rejectedBy: buyer._id, reason: "Slight size variation, not suitable for hotel plating", defectType: "size_mismatch", rejectedAt: daysAgo(1) }],
  });
  // A reserved order waiting for the sale to be completed
  await MarketplaceListing.create({
    farmer: farmer._id, cropType: "Pumpkin", quantityKg: 200, originalPricePerKg: 100, currentPricePerKg: 100, agreedPricePerKg: 100,
    harvestDate: daysAgo(2), qualityGrade: "A", tier: "primary", status: "reserved", orderedBy: buyer._id, targetBuyerSegment: primarySegments,
  });
  // Produce a buyer rejected that still SOLD on the flash-sale market: "waste rescued".
  const rescuedSales = [
    ["Tomato", 200, 230, 110, 5], ["Carrot", 300, 230, 150, 8], ["Cabbage", 150, 110, 70, 3],
  ];
  await MarketplaceListing.insertMany(
    rescuedSales.map(([cropType, kg, original, price, ago]) => ({
      farmer: farmer._id, cropType, quantityKg: kg, originalPricePerKg: original, currentPricePerKg: price, agreedPricePerKg: price,
      markdownPercentApplied: Math.round((1 - price / original) * 100), harvestDate: daysAgo(ago + 2), qualityGrade: "B",
      tier: "secondary", targetBuyerSegment: ["factory", "restaurant", "compost_hub"], status: "sold", orderedBy: buyer2._id, soldAt: daysAgo(ago),
      rejectionHistory: [{ rejectedBy: buyer._id, reason: "Cosmetic defects", defectType: "visual_defect", rejectedAt: daysAgo(ago + 1) }],
      createdAt: daysAgo(ago + 3), updatedAt: daysAgo(ago),
    }))
  );
  console.log("Created sold history + live listings at different freshness stages.");

  // ---- 7. Group lots ----
  const n = (i) => neighbours[i - 1]; // 1-based helper: n(4) = neighbour #4
  await GroupLot.create({
    cropType: "Carrot", district: "Kandy", targetKg: 500, pricePerKg: 225, pickupNote: "Kandy central market, Gate 2",
    createdBy: n(4)._id, members: [{ farmer: n(4)._id, quantityKg: 200 }, { farmer: n(5)._id, quantityKg: 180 }],
    committedKg: 380, status: "open", closesAt: daysFromNow(4),
  });
  await GroupLot.create({
    cropType: "Pumpkin", district: "Kandy", targetKg: 300, pricePerKg: 95, pickupNote: "Peradeniya junction, Saturday morning",
    createdBy: n(6)._id, members: [{ farmer: n(6)._id, quantityKg: 150 }, { farmer: n(2)._id, quantityKg: 100 }, { farmer: n(7)._id, quantityKg: 50 }],
    committedKg: 300, status: "full", closesAt: daysFromNow(3),
  });
  await GroupLot.create({
    cropType: "Beans (Bush)", district: "Kandy", targetKg: 200, pricePerKg: 360, pickupNote: "",
    createdBy: n(1)._id, members: [{ farmer: n(1)._id, quantityKg: 40 }],
    committedKg: 40, status: "open", closesAt: daysFromNow(6),
  });

  // A group sale that already completed (claimed by the second buyer)
  await GroupLot.create({
    cropType: "Cabbage", district: "Kandy", targetKg: 300, pricePerKg: 80, pickupNote: "Kandy market, Gate 1",
    createdBy: n(8)._id, members: [{ farmer: n(8)._id, quantityKg: 120 }, { farmer: n(4)._id, quantityKg: 100 }, { farmer: n(5)._id, quantityKg: 80 }],
    committedKg: 300, status: "claimed", claimedBy: buyer2._id, claimedAt: daysAgo(6), closesAt: daysAgo(5),
  });

  // ---- 8. Buyer demand board ----
  const beansRequest = await DemandRequest.create({
    buyer: buyer._id, cropType: "Beans (Bush)", quantityKg: 300, maxPricePerKg: 420, neededBy: daysFromNow(9),
    district: "Kandy", note: "Grade A only, delivered to our Kandy kitchen.",
    offers: [{ farmer: n(1)._id, quantityKg: 120, pricePerKg: 400, message: "Harvest starts next week, can deliver in two batches." }],
  });
  await DemandRequest.create({
    buyer: buyer._id, cropType: "Carrot", quantityKg: 200, maxPricePerKg: 260, neededBy: daysFromNow(6), district: "", note: "Any district — we arrange collection.",
  });
  await DemandRequest.create({
    buyer: buyer._id, cropType: "Pumpkin", quantityKg: 500, maxPricePerKg: 110, neededBy: daysFromNow(12), district: "Kandy", note: "Bulk order for our restaurant group.",
  });
  // A request that has already been fully covered
  await DemandRequest.create({
    buyer: buyer2._id, cropType: "Carrot", quantityKg: 200, maxPricePerKg: 240, neededBy: daysFromNow(2), district: "Kandy",
    status: "fulfilled", fulfilledKg: 200,
    offers: [
      { farmer: n(4)._id, quantityKg: 120, pricePerKg: 230, status: "accepted", acceptedKg: 120 },
      { farmer: n(5)._id, quantityKg: 80, pricePerKg: 235, status: "accepted", acceptedKg: 80 },
    ],
  });
  console.log("Created 4 group lots and 4 buyer requests (one with a farmer offer, one already fulfilled).");

  // ---- 9. Crowdfunding (also feeds the Farm Passport) ----
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
    farmer: farmer._id, timelineRef: "demo-timeline-beans", cropType: "Beans (Bush)",
    description: "Trellis poles and organic fertilizer for a bean crop.",
    fundingGoalLkr: 50000, amountRaisedLkr: 50000, returnPercentage: 10, deadline: daysFromNow(25), status: "funded",
    pledges: [{ investor: buyer._id, amountLkr: 50000, expectedReturnLkr: 55000, status: "pledged", pledgedAt: daysAgo(3) }],
  });
  await CrowdfundingCampaign.create({
    farmer: farmer._id, timelineRef: "demo-timeline-pumpkin-last-season", cropType: "Pumpkin",
    description: "Last season's pumpkin crop — fully funded and repaid on time.",
    fundingGoalLkr: 40000, amountRaisedLkr: 40000, returnPercentage: 10, deadline: daysAgo(30), status: "repaid",
    pledges: [{ investor: buyer._id, amountLkr: 40000, expectedReturnLkr: 44000, status: "repaid", pledgedAt: daysAgo(90) }],
  });
  console.log("Created 3 crowdfunding campaigns.");

  console.log("\nDONE. Demo logins:");
  console.log(`  Farmer : ${FARMER_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Buyer  : ${BUYER_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  (37 neighbour farmers and a second buyer were also created — they're only there to make the district data realistic.)`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Seeding failed:", err.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
