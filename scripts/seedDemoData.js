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
 *   - GROUP CHAT conversations in English, Sinhala and Tamil (a Tomato group,
 *     a Kandy group and an "All farmers" group) so the chat is alive on day one
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
const GroupMembership = require("../models/GroupMembership");
const GroupMessage = require("../models/GroupMessage");
const ChatMedia = require("../models/ChatMedia");
const ChatReport = require("../models/ChatReport");
const { makeAlias } = require("../utils/chatConfig");
const Advertisement = require("../models/Advertisement");
const LedgerEntry = require("../models/LedgerEntry");
const PriceAlert = require("../models/PriceAlert");
const MarketPrice = require("../models/MarketPrice");
const TradeOrder = require("../models/TradeOrder");
const Rating = require("../models/Rating");
const ReturnTrip = require("../models/ReturnTrip");
const Survey = require("../models/Survey");
const SurveyResponse = require("../models/SurveyResponse");
const ProfileImage = require("../models/ProfileImage");
const DRIVER_EMAIL = "demo.driver@agrilink.lk";
const DEMO_AD_BRANDS = ["Lanka Fuel Card", "Ceylon Tyre Mart", "AgroSure Crop Insurance", "Kandy Cold Store", "GreenGrow Seeds"];

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
    $or: [{ email: { $in: [FARMER_EMAIL, BUYER_EMAIL, DRIVER_EMAIL] } }, { email: { $regex: `${NEIGHBOUR_DOMAIN.replace(/\./g, "\\.")}$` } }],
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
    await GroupMembership.deleteMany({ user: { $in: previousIds } });
    await LedgerEntry.deleteMany({ farmer: { $in: previousIds } });
    await PriceAlert.deleteMany({ farmer: { $in: previousIds } });
    await TradeOrder.deleteMany({ $or: [{ farmer: { $in: previousIds } }, { buyer: { $in: previousIds } }] });
    await Rating.deleteMany({ $or: [{ rater: { $in: previousIds } }, { ratee: { $in: previousIds } }] });
    await ReturnTrip.deleteMany({ driver: { $in: previousIds } });
    await SurveyResponse.deleteMany({ respondent: { $in: previousIds } });
    await ProfileImage.deleteMany({ user: { $in: previousIds } });
    await MarketPrice.deleteMany({ reporter: { $in: previousIds } });
    await GroupMessage.deleteMany({ sender: { $in: previousIds } });
    await GroupMessage.deleteMany({ type: "system" }); // outbreak alerts from earlier demos
    await ChatMedia.deleteMany({ uploader: { $in: previousIds } });
    await ChatReport.deleteMany({ reporter: { $in: previousIds } });
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

  // ---- 10. Group chat conversations (three neighbours who are NOT used in the automated tests) ----
  const chatters = { n5: n(5), n7: n(7), n8: n(8) };
  const memberOf = async (farmerDoc, groupKey) => {
    const identity = makeAlias(farmerDoc._id, groupKey);
    await GroupMembership.create({ user: farmerDoc._id, groupKey, alias: identity.alias, avatarHue: identity.avatarHue, avatarEmoji: identity.avatarEmoji, joinedAt: daysAgo(3), lastReadAt: daysAgo(3) });
    return identity;
  };
  const say = async (farmerDoc, groupKey, text, minutesAgo, extra = {}) => {
    const identity = makeAlias(farmerDoc._id, groupKey);
    return GroupMessage.create({ groupKey, sender: farmerDoc._id, alias: identity.alias, avatarHue: identity.avatarHue, avatarEmoji: identity.avatarEmoji, type: "text", text, createdAt: new Date(Date.now() - minutesAgo * 60000), updatedAt: new Date(Date.now() - minutesAgo * 60000), ...extra });
  };

  await Promise.all([memberOf(chatters.n5, "crop:Tomato"), memberOf(chatters.n7, "crop:Tomato")]);
  const q = await say(chatters.n5, "crop:Tomato", "Anyone seeing yellow spots on tomato leaves after the rain? It started 3 days ago.", 300);
  const a1 = await say(chatters.n7, "crop:Tomato", "Yes, same here. I think it is Late Blight. I sprayed a copper fungicide yesterday.", 285, { replyTo: q._id, replyPreview: { alias: makeAlias(chatters.n5._id, "crop:Tomato").alias, kind: "text", text: q.text.slice(0, 80) } });
  const a2 = await say(chatters.n5, "crop:Tomato", "How many times did you spray?", 270);
  await say(chatters.n7, "crop:Tomato", "Twice, 5 days apart. Remove the badly infected leaves first and don't water from above.", 255, { replyTo: a2._id, replyPreview: { alias: makeAlias(chatters.n5._id, "crop:Tomato").alias, kind: "text", text: a2.text.slice(0, 80) } });
  await GroupMessage.updateOne({ _id: a1._id }, { $set: { helpfulBy: [chatters.n5._id, chatters.n8._id] } });

  await Promise.all([memberOf(chatters.n5, "district:Kandy"), memberOf(chatters.n7, "district:Kandy"), memberOf(chatters.n8, "district:Kandy")]);
  await say(chatters.n8, "district:Kandy", "අද කොළඹ යන ට්‍රක් එකක් තියෙනවද? තක්කාලි කිලෝ 200ක් යවන්න ඕනේ.", 200);
  await say(chatters.n5, "district:Kandy", "පේරාදෙණිය හන්දියෙන් හෙට උදේ 6ට ට්‍රක් එකක් යනවා. ඔයාට ඉඩ තියෙනවා.", 190);
  await say(chatters.n7, "district:Kandy", "Prices at Dambulla today: tomato Rs. 170, beans Rs. 350, carrot Rs. 240.", 90);

  await Promise.all([memberOf(chatters.n7, "all"), memberOf(chatters.n8, "all")]);
  await say(chatters.n7, "all", "நல்ல மழை பெய்தது. எல்லோரும் உங்கள் பயிர்களை பாதுகாக்கவும்.", 60);
  await say(chatters.n8, "all", "Thanks for the reminder! Stay safe everyone.", 45);
  console.log("Created group chat conversations (English, Sinhala, Tamil).");

  // ---- 11. Update 4 demo data: ads, prices, surveys, trust history, return trips, farm ledger ----
  // (Demo ads/prices/surveys are credited to the demo buyer — the seed never creates an admin account with a known password.)
  await Advertisement.deleteMany({ brandName: { $in: DEMO_AD_BRANDS } });
  const adDefaults = { createdBy: buyer._id, scheduleStart: daysAgo(1), scheduleEnd: daysFromNow(90), isActive: true };
  await Advertisement.create([
    { ...adDefaults, brandName: "Lanka Fuel Card", category: "fuel", placements: ["logistics", "driver"], headline: "Save Rs. 8 on every litre of diesel", body: "Fuel discounts at 400+ stations for AgriLink truck drivers.", ctaLabel: "Get the card", emoji: "⛽", accentColor: "#B45309", clickThroughUrl: "https://example.com/lanka-fuel-card" },
    { ...adDefaults, brandName: "Ceylon Tyre Mart", category: "tyres", placements: ["logistics", "driver"], headline: "Free tyre check before long hauls", body: "Book a 10-minute safety check at any Ceylon Tyre Mart.", ctaLabel: "Book a check", emoji: "🛞", accentColor: "#1D4ED8", clickThroughUrl: "https://example.com/ceylon-tyre-mart" },
    { ...adDefaults, brandName: "AgroSure Crop Insurance", category: "insurance", placements: ["marketplace", "timeline"], headline: "Protect this season's harvest", body: "Rain or blight? Cover starts from Rs. 1,200 per acre.", ctaLabel: "Get a quote", emoji: "🛡️", accentColor: "#7C3AED", clickThroughUrl: "https://example.com/agrosure" },
    { ...adDefaults, brandName: "Kandy Cold Store", category: "cold_storage", placements: ["logistics", "marketplace"], headline: "Cold storage from Rs. 3 per kg per day", body: "Keep tomatoes and beans fresh while you wait for the best price.", ctaLabel: "See rates", emoji: "❄️", accentColor: "#0E7490", clickThroughUrl: "https://example.com/kandy-cold-store" },
    { ...adDefaults, brandName: "GreenGrow Seeds", category: "seeds", placements: ["timeline", "scanner"], headline: "Blight-resistant tomato seed", body: "Certified seed for the next season. Free delivery in Kandy.", ctaLabel: "Order seed", emoji: "🌱", accentColor: "#15803D", clickThroughUrl: "https://example.com/greengrow" },
  ]);

  // Official prices: 10 days of history at three markets, with a Tomato jump today at Dambulla
  await MarketPrice.deleteMany({ isDemo: true });
  const priceBase = { Tomato: 180, "Beans (Bush)": 320, Carrot: 240, Cabbage: 130, "Brinjal (Eggplant)": 210, Pumpkin: 95, Cucumber: 110, "Okra (Bandakka)": 260, "Bitter Gourd": 300, "Onion (Big/Red)": 220, Chili: 480, Banana: 150 };
  const marketFactor = { Dambulla: 1, Manning: 1.12, Kandy: 1.06 };
  const priceRows = [];
  for (let d = 9; d >= 0; d--) {
    const day = new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
    Object.entries(priceBase).forEach(([crop, base], ci) => Object.entries(marketFactor).forEach(([market, f]) => {
      let price = base * f * (1 + 0.06 * Math.sin((d + ci) / 2.2));
      if (crop === "Tomato" && market === "Dambulla" && d === 0) price = priceRows.filter((r) => r.cropType === "Tomato" && r.market === "Dambulla").slice(-1)[0].pricePerKg * 1.22;
      priceRows.push({ cropType: crop, market, pricePerKg: Math.round(price), day, source: "admin", verified: true, reporter: buyer._id, isDemo: true });
    }));
  }
  await MarketPrice.insertMany(priceRows);
  await PriceAlert.create({ farmer: farmer._id, cropType: "Tomato", direction: "above", thresholdLkr: 200, market: "" });

  // Surveys with demo answers from the neighbour farmers (clearly marked demo in the admin results)
  const oldSurveys = await Survey.find({ isDemo: true }).select("_id");
  if (oldSurveys.length) await SurveyResponse.deleteMany({ survey: { $in: oldSurveys.map((x) => x._id) } });
  await Survey.deleteMany({ isDemo: true });
  const lossSurvey = await Survey.create({ isDemo: true, createdBy: buyer._id, title: "Harvest losses & selling", intro: "Two minutes. Your answers help us build tools for farmers like you.", questions: [
    { key: "q1", kind: "number", text: "About what percent of your last harvest was lost before it could be sold?", unit: "%", required: true },
    { key: "q2", kind: "single", text: "What was the MAIN reason?", options: ["No buyer found in time", "Price too low", "Transport problem", "Spoiled before sale", "Pest or disease", "Other"], required: true },
    { key: "q3", kind: "single", text: "How do you usually sell?", options: ["To a middleman at my farm", "At the market myself", "Through a cooperative", "Directly to a hotel or shop", "Other"], required: true },
  ] });
  await Survey.create({ isDemo: true, createdBy: buyer._id, title: "Would you use these tools?", intro: "Tell us what would actually help you.", questions: [
    { key: "q1", kind: "scale", text: "How useful would selling together with neighbours (group lots) be? (1 = not at all, 5 = very)", required: true },
    { key: "q2", kind: "scale", text: "How much would you trust a buyer who has good ratings? (1–5)", required: true },
    { key: "q3", kind: "text", text: "What is the biggest problem we should solve next?", required: false },
  ] });
  const lossReasons = lossSurvey.questions[1].options, sellWays = lossSurvey.questions[2].options;
  await SurveyResponse.insertMany(neighbours.map((f, i) => ({
    survey: lossSurvey._id, respondent: f._id, district: f.farmerProfile.district,
    answers: { q1: 8 + ((i * 7) % 24) + (f.farmerProfile.district === "Nuwara Eliya" ? 6 : 0), q2: lossReasons[(i * 3 + (i % 4 === 0 ? 1 : 0)) % lossReasons.length], q3: sellWays[(i * 5) % 3 === 0 ? 0 : (i % sellWays.length)] },
  })));

  // Trust history: completed & rated orders so badges are visible (recorded directly; the real flow is tested separately)
  const mkPaid = async (farmerDoc, buyerDoc, crop, kg, price, stars, tags, farmerStars) => {
    const order = await TradeOrder.create({ listing: new mongoose.Types.ObjectId(), farmer: farmerDoc._id, buyer: buyerDoc._id, cropType: crop, quantityKg: kg, pricePerKg: price, totalLkr: kg * price, status: "paid", events: [{ status: "paid", by: "farmer", at: daysAgo(3) }] });
    await Rating.create({ order: order._id, rater: buyerDoc._id, ratee: farmerDoc._id, stars, tags });
    if (farmerStars) await Rating.create({ order: order._id, rater: farmerDoc._id, ratee: buyerDoc._id, stars: farmerStars, tags: ["paid_promptly"] });
  };
  const trustFarmers = [n(9), n(10), n(11)];
  for (let i = 0; i < 6; i++) await mkPaid(trustFarmers[0], i % 2 ? buyer2 : buyer, ["Tomato", "Carrot", "Beans (Bush)"][i % 3], 120 + i * 20, 170 + i * 5, i === 5 ? 4 : 5, ["on_time", "good_quality"], 5);
  for (let i = 0; i < 3; i++) await mkPaid(trustFarmers[1], buyer, "Carrot", 90 + i * 10, 230, 4, ["fair_price"], i === 0 ? 4 : 0);
  await mkPaid(trustFarmers[2], buyer2, "Carrot", 60, 240, 5, ["honest_weight"], 0);

  // A demo truck driver with three return trips that are already posted
  const driver = await User.create({ fullName: "Kumara Perera (Demo Driver)", email: DRIVER_EMAIL, phone: "+94771230000", passwordHash, role: "driver", driverProfile: { vehicleRegistrationNo: "WP LB-4821", vehicleCapacityKg: 3000 } });
  await ReturnTrip.create([
    { driver: driver._id, vehicleRegistrationNo: "WP LB-4821", fromHub: "Colombo_Manning_Market", toDistrict: "Kandy", departAt: new Date(Date.now() + 18 * 3600000), availableKg: 900, pricePerKg: 11, regularPricePerKg: 20, note: "Empty after a Manning Market delivery — can pick up along the A1." },
    { driver: driver._id, vehicleRegistrationNo: "WP LB-4821", fromHub: "Dambulla", toDistrict: "Nuwara Eliya", departAt: new Date(Date.now() + 40 * 3600000), availableKg: 700, pricePerKg: 14, regularPricePerKg: 24 },
    { driver: driver._id, vehicleRegistrationNo: "WP LB-4821", fromHub: "Pettah", toDistrict: "Matale", departAt: new Date(Date.now() + 26 * 3600000), availableKg: 500, pricePerKg: 10, regularPricePerKg: 18 },
  ]);

  // The demo farmer's money book for a tomato season
  const ledger = [["expense", "seeds", 18500, 78, "Hybrid tomato seed"], ["expense", "fertilizer", 24000, 70, "Base + top-dress fertilizer"], ["expense", "labour", 42000, 60, "Planting and weeding"], ["expense", "pesticide", 9200, 40, "Blight spray x2"], ["expense", "transport", 6500, 12, "Truck to Dambulla"], ["expense", "water", 5200, 30, "Irrigation pump fuel"], ["income", "sale", 168000, 8, "Sold to Green Basket Hotels"], ["expense", "labour", 15000, 45, "Harvest labour"]];
  await LedgerEntry.insertMany(ledger.map(([type, category, amountLkr, ago, note]) => ({ farmer: farmer._id, cropType: "Tomato", type, category, amountLkr, note, date: daysAgo(ago) })));
  console.log("Created demo ads, prices, surveys, trust history, return trips and a farm ledger.");

  console.log("\nDONE. Demo logins:");
  console.log(`  Farmer : ${FARMER_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Buyer  : ${BUYER_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Driver : ${DRIVER_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  (37 neighbour farmers and a second buyer were also created — they're only there to make the district data realistic.)`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Seeding failed:", err.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
