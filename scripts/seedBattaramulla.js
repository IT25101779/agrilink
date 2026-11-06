/**
 * EXTRA DEMO DATA for the hackX final at Water's Edge, Battaramulla (Colombo).
 *
 * Run it AFTER the normal demo seed:
 *     node scripts/seedDemoData.js        (once, creates the base demo)
 *     node scripts/seedBattaramulla.js    (this file - adds the Colombo layer)
 *
 * What it adds (all clearly DEMO data, safe to re-run - it removes its own
 * rows first and never touches real users):
 *   - Official demo prices for ALL 8 markets (Dambulla, Manning, Pettah, Kandy,
 *     Jaffna, Meegoda, Narahenpita, Thambuttegama) x 16 crops x 10 days, plus a
 *     few farmer-reported (unverified) prices at the Colombo markets
 *   - 10 demo lorries/trucks around Battaramulla, Malabe, Rajagiriya, Kaduwela...
 *     (Logistics > "Find a truck"), some with cargo bookings, plus 2 near Kandy
 *   - Return-load trips (cheap empty-truck journeys) to Colombo-side districts
 *   - 8 nearby suppliers / machinery rentals (Seeds, fertilizer, tools, hire)
 *   - Agriculture offices for Colombo district (the Ministry of Agriculture head
 *     office in Battaramulla is a REAL entry; the rest are labelled samples)
 *   - A Colombo-district demo farmer (login below) with crops, listings, sales
 *     history, money book, price alert, crowdfunding; 12 Colombo neighbours so
 *     the Oversupply Guard has something to say (Okra is crowded); 2 buyers;
 *     group lots and a buyer demand board for Colombo
 *
 * Demo logins (password = DEMO_PASSWORD in .env, default Demo@1234):
 *     Farmer : demo.battaramulla@agrilink.lk
 *     Buyer  : demo.hotel.colombo@agrilink.lk
 *     Driver : demo.driver1@agrilink.lk  (and demo.driver2 ... demo.driver10)
 *
 * NOTE: business names and phone numbers of the demo suppliers/drivers are
 * FICTIONAL. Say "demo data" if asked. Coordinates are approximate.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const MarketPrice = require("../models/MarketPrice");
const LorryFleetTracking = require("../models/LorryFleetTracking");
const ReturnTrip = require("../models/ReturnTrip");
const LocalSupplier = require("../models/LocalSupplier");
const AgriOffice = require("../models/AgriOffice");
const MarketplaceListing = require("../models/MarketplaceListing");
const CultivationTimeline = require("../models/CultivationTimeline");
const LedgerEntry = require("../models/LedgerEntry");
const YieldRecord = require("../models/YieldRecord");
const PriceAlert = require("../models/PriceAlert");
const GroupLot = require("../models/GroupLot");
const DemandRequest = require("../models/DemandRequest");
const CrowdfundingCampaign = require("../models/CrowdfundingCampaign");

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "Demo@1234";
const DOMAIN = "@battaramulla.demo.agrilink.lk";
const FARMER_EMAIL = "demo.battaramulla@agrilink.lk";
const BUYER_EMAIL = "demo.hotel.colombo@agrilink.lk";
const DRIVER_EMAILS = Array.from({ length: 10 }, (_, i) => `demo.driver${i + 1}@agrilink.lk`);
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const daysFromNow = (n) => new Date(Date.now() + n * DAY);
const hoursFromNow = (n) => new Date(Date.now() + n * 3600000);

// [lng, lat] - approximate points
const HOTEL = [79.919, 6.8995]; // Water's Edge area, Battaramulla
const PLACES = {
  Battaramulla: [79.919, 6.901], Malabe: [79.958, 6.907], Rajagiriya: [79.895, 6.909], Nawala: [79.889, 6.895],
  Kotte: [79.907, 6.891], Thalawathugoda: [79.924, 6.873], Pelawatta: [79.933, 6.897], Koswatte: [79.915, 6.904],
  Kaduwela: [79.984, 6.933], Maharagama: [79.926, 6.848], Homagama: [80.002, 6.844], Kandy: [80.6337, 7.2906],
  Peradeniya: [80.595, 7.259],
};
const near = ([lng, lat], i = 0) => [lng + ((i * 37) % 11 - 5) * 0.0009, lat + ((i * 53) % 9 - 4) * 0.0009];
const point = (c) => ({ type: "Point", coordinates: c });

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env file.");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB.");

  // ---------- 1. remove a previous run of THIS script ----------
  const old = await User.find({ $or: [{ email: { $in: [FARMER_EMAIL, BUYER_EMAIL, ...DRIVER_EMAILS] } }, { email: { $regex: `${DOMAIN.replace(/\./g, "\\.")}$` } }] }).select("_id");
  const oldIds = old.map((u) => u._id);
  if (oldIds.length) {
    await Promise.all([
      MarketPrice.deleteMany({ reporter: { $in: oldIds } }),
      LorryFleetTracking.deleteMany({ driver: { $in: oldIds } }),
      ReturnTrip.deleteMany({ driver: { $in: oldIds } }),
      LocalSupplier.deleteMany({ createdBy: { $in: oldIds } }),
      MarketplaceListing.deleteMany({ $or: [{ farmer: { $in: oldIds } }, { orderedBy: { $in: oldIds } }] }),
      CultivationTimeline.deleteMany({ farmer: { $in: oldIds } }),
      LedgerEntry.deleteMany({ farmer: { $in: oldIds } }),
      YieldRecord.deleteMany({ farmer: { $in: oldIds } }),
      PriceAlert.deleteMany({ farmer: { $in: oldIds } }),
      GroupLot.deleteMany({ createdBy: { $in: oldIds } }),
      DemandRequest.deleteMany({ buyer: { $in: oldIds } }),
      CrowdfundingCampaign.deleteMany({ farmer: { $in: oldIds } }),
    ]);
    await User.deleteMany({ _id: { $in: oldIds } });
    console.log("Removed the previous Battaramulla demo layer.");
  }
  await AgriOffice.deleteMany({ isSample: true, district: { $in: ["Colombo", "Gampaha"] } });
  await AgriOffice.deleteMany({ name: "Ministry of Agriculture - Head Office" });

  const passwordHash = await User.hashPassword(DEMO_PASSWORD);

  // ---------- 2. accounts ----------
  const buyer = await User.create({
    fullName: "Lakeside Hotels Colombo (Demo Buyer)", email: BUYER_EMAIL, phone: "+94112000111", passwordHash, role: "buyer",
    buyerProfile: { companyName: "Lakeside Hotels Colombo", buyerType: "hotel", verifiedBusiness: true },
  });
  const buyer2 = await User.create({
    fullName: "Colombo Fresh Supermarkets (Demo Buyer 2)", email: `buyer2${DOMAIN}`, phone: "+94112000222", passwordHash, role: "buyer",
    buyerProfile: { companyName: "Colombo Fresh Supermarkets", buyerType: "supermarket", verifiedBusiness: true },
  });

  const farmer = await User.create({
    fullName: "Saman Jayasuriya (Battaramulla Demo Farmer)", email: FARMER_EMAIL, phone: "+94771230011", passwordHash, role: "farmer",
    createdAt: daysAgo(100),
    farmerProfile: { district: "Colombo", landSizeAcres: 1.5, soilType: "loamy", gpsLocation: point(PLACES.Pelawatta), creditScore: 610, completedTimelinesCount: 2 },
  });

  const NEIGHBOURS = [
    ["Kumudu Perera", "Malabe", ["Okra (Bandakka)", "Brinjal (Eggplant)"]],
    ["Dilini Fernando", "Kaduwela", ["Okra (Bandakka)", "Snake Gourd"]],
    ["Ruwan Silva", "Battaramulla", ["Okra (Bandakka)", "Chili"]],
    ["Nadeeka Gamage", "Homagama", ["Okra (Bandakka)", "Bitter Gourd"]],
    ["Prasanna Wijeratne", "Maharagama", ["Okra (Bandakka)", "Cucumber"]],
    ["Sujeewa Karunaratne", "Thalawathugoda", ["Okra (Bandakka)", "Banana"]],
    ["Chandani Rodrigo", "Kotte", ["Okra (Bandakka)", "Pumpkin"]],
    ["Asanka Liyanage", "Malabe", ["Brinjal (Eggplant)", "Snake Gourd"]],
    ["Thushari Mendis", "Kaduwela", ["Brinjal (Eggplant)", "Bitter Gourd"]],
    ["Gayan Seneviratne", "Homagama", ["Chili", "Cucumber"]],
    ["Hasini Jayawardena", "Rajagiriya", ["Banana", "Papaya"]],
    ["Lakmal Abeywickrama", "Nawala", ["Beans (Bush)", "Cabbage"]],
  ];
  const DUR = { "Okra (Bandakka)": 60, "Brinjal (Eggplant)": 80, "Snake Gourd": 70, Chili: 90, "Bitter Gourd": 65, Cucumber: 50, Banana: 270, Pumpkin: 100, Papaya: 240, "Beans (Bush)": 55, Cabbage: 70 };
  const neighbours = [];
  let tCount = 0;
  for (let i = 0; i < NEIGHBOURS.length; i++) {
    const [fullName, place, crops] = NEIGHBOURS[i];
    const loc = near(PLACES[place], i);
    const u = await User.create({
      fullName, email: `neighbour${i + 1}${DOMAIN}`, phone: `+9477${String(3000000 + i * 1357).slice(0, 7)}`, passwordHash, role: "farmer",
      farmerProfile: { district: "Colombo", landSizeAcres: 0.5 + (i % 3) * 0.5, soilType: "loamy", gpsLocation: point(loc), creditScore: 520 + i * 12 },
    });
    neighbours.push(u);
    for (const cropType of crops) {
      const planted = 8 + ((i * 5 + tCount * 3) % 30);
      tCount += 1;
      await CultivationTimeline.create({
        farmer: u._id, cropType, landSizeAcres: 0.5, soilType: "loamy", gpsLocation: point(loc),
        plantingDate: daysAgo(planted), expectedHarvestDate: daysFromNow(Math.max(7, (DUR[cropType] || 80) - planted)),
        status: "active", localId: `bt-${i + 1}-${cropType.replace(/\W/g, "").toLowerCase()}`, syncStatus: "synced",
      });
    }
  }
  // the demo farmer's own crops
  const mine = [["Okra (Bandakka)", 28], ["Brinjal (Eggplant)", 40], ["Snake Gourd", 22], ["Chili", 35]];
  for (const [cropType, planted] of mine) {
    await CultivationTimeline.create({
      farmer: farmer._id, cropType, landSizeAcres: 0.4, soilType: "loamy", gpsLocation: point(PLACES.Pelawatta),
      plantingDate: daysAgo(planted), expectedHarvestDate: daysFromNow(Math.max(7, DUR[cropType] - planted)),
      status: "active", localId: `bt-demo-${cropType.replace(/\W/g, "").toLowerCase()}`, syncStatus: "synced",
    });
  }
  console.log(`Created Colombo farmer, 2 buyers, ${neighbours.length} neighbours and ${tCount + mine.length} crop timelines.`);

  // ---------- 3. prices for ALL 8 markets ----------
  const base = {
    Tomato: 180, "Beans (Bush)": 320, Carrot: 240, Cabbage: 130, "Brinjal (Eggplant)": 210, Pumpkin: 95, Cucumber: 110, "Okra (Bandakka)": 260,
    "Bitter Gourd": 300, "Onion (Big/Red)": 220, Chili: 480, Banana: 150, "Snake Gourd": 175, Leeks: 270, Beetroot: 195, Papaya: 120,
  };
  const factor = { Dambulla: 1.0, Manning: 1.12, Pettah: 1.14, Kandy: 1.06, Jaffna: 1.1, Meegoda: 1.03, Narahenpita: 1.17, Thambuttegama: 0.96 };
  await MarketPrice.deleteMany({ isDemo: true });
  const rows = [];
  for (let d = 9; d >= 0; d--) {
    const day = new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
    Object.entries(base).forEach(([crop, b], ci) => Object.entries(factor).forEach(([market, f], mi) => {
      let price = b * f * (1 + 0.06 * Math.sin((d + ci) / 2.2) + 0.012 * Math.cos(mi + d));
      // today: Tomato jumps 22% at Dambulla (drives the market-shock demo + price alerts)
      if (crop === "Tomato" && market === "Dambulla" && d === 0) {
        const prev = rows.filter((r) => r.cropType === "Tomato" && r.market === "Dambulla").slice(-1)[0];
        price = prev.pricePerKg * 1.22;
      }
      // today: Okra is cheap everywhere in Colombo (matches the crowded-Okra story)
      if (crop === "Okra (Bandakka)" && ["Manning", "Pettah", "Narahenpita", "Meegoda"].includes(market) && d === 0) price *= 0.9;
      rows.push({ cropType: crop, market, pricePerKg: Math.round(price), day, source: "admin", verified: true, reporter: buyer._id, isDemo: true });
    }));
  }
  const today = new Date().toISOString().slice(0, 10);
  // farmers reporting what they saw today (unverified, shown as "Farmers saw: LKR X (n)")
  const reported = [["Okra (Bandakka)", "Manning", 0.95], ["Okra (Bandakka)", "Pettah", 0.97], ["Brinjal (Eggplant)", "Manning", 1.05], ["Snake Gourd", "Narahenpita", 1.04],
    ["Chili", "Pettah", 1.06], ["Banana", "Meegoda", 0.98], ["Tomato", "Manning", 1.08], ["Beans (Bush)", "Narahenpita", 1.03]];
  reported.forEach(([crop, market, k], i) => {
    const official = rows.find((r) => r.cropType === crop && r.market === market && r.day === today);
    rows.push({ cropType: crop, market, pricePerKg: Math.round(official.pricePerKg * k), day: today, source: "farmer", verified: false, reporter: neighbours[i % neighbours.length]._id, isDemo: true, clientId: `bt-rep-${i}` });
  });
  await MarketPrice.insertMany(rows);
  await PriceAlert.create([
    { farmer: farmer._id, cropType: "Okra (Bandakka)", direction: "above", thresholdLkr: 300, market: "" },
    { farmer: farmer._id, cropType: "Brinjal (Eggplant)", direction: "above", thresholdLkr: 230, market: "Manning" },
  ]);
  console.log(`Created ${rows.length} price rows across 8 markets.`);

  // ---------- 4. drivers + lorries around Battaramulla ----------
  const DRIVERS = [
    // name, plate, capacityKg, freeKg, place, hub, status, tracking
    ["Chaminda Rathnayake", "WP CBA-5521", 3000, 1400, "Battaramulla", "Colombo_Manning_Market", "en_route", true],
    ["Ruwan Pushpakumara", "WP LH-3908", 2500, 900, "Malabe", "Pettah", "en_route", true],
    ["Saman Dharmasena", "WP PC-7746", 5000, 2600, "Kaduwela", "Dambulla", "en_route", true],
    ["Lasith Kodikara", "WP KT-1184", 1500, 700, "Rajagiriya", "Colombo_Manning_Market", "loading", true],
    ["Mahinda Ekanayake", "WP LD-9025", 4000, 3100, "Thalawathugoda", "Kandy", "en_route", true],
    ["Nadeesha Weerakoon", "NW LC-2217", 3500, 1800, "Pelawatta", "Other", "en_route", true],
    ["Prasad Gunawardena", "WP BCD-4408", 2000, 2000, "Koswatte", "Colombo_Manning_Market", "idle", true],
    ["Sisira Kumara", "WP KR-6073", 6000, 4200, "Homagama", "Dambulla", "en_route", true],
    ["Anura Bandara", "CP LA-3390", 3000, 1500, "Kandy", "Colombo_Manning_Market", "en_route", true],
    ["Dilan Herath", "CP KB-8146", 2200, 1100, "Peradeniya", "Pettah", "loading", true],
  ];
  const drivers = [];
  for (let i = 0; i < DRIVERS.length; i++) {
    const [fullName, plate, cap] = DRIVERS[i];
    drivers.push(await User.create({
      fullName: `${fullName} (Demo Driver)`, email: DRIVER_EMAILS[i], phone: `+9477${String(4100000 + i * 911).slice(0, 7)}`, passwordHash, role: "driver",
      driverProfile: { vehicleRegistrationNo: plate, vehicleCapacityKg: cap, isOnDuty: true },
    }));
  }
  await LorryFleetTracking.deleteMany({ driver: { $in: drivers.map((d) => d._id) } });
  const lorries = await LorryFleetTracking.insertMany(DRIVERS.map(([, plate, cap, free, place, hub, status, tracking], i) => ({
    driver: drivers[i]._id, vehicleRegistrationNo: plate, totalCapacityKg: cap, remainingCapacityKg: free,
    currentLocation: point(near(PLACES[place], i + 2)), destinationHub: hub, isTrackingActive: tracking, routeStatus: status,
  })));
  // a few cargo bookings from the demo farmer / neighbours so "My bookings" is not empty
  const book = async (lorryIdx, farmerDoc, kg, status, place) => {
    const l = await LorryFleetTracking.findById(lorries[lorryIdx]._id);
    l.cargoBookings.push({ farmer: farmerDoc._id, weightKg: kg, status, pickupLocation: point(near(PLACES[place], lorryIdx)) });
    await l.save();
  };
  await book(0, farmer, 180, "confirmed", "Pelawatta");
  await book(0, neighbours[0], 220, "requested", "Malabe");
  await book(1, neighbours[1], 300, "confirmed", "Kaduwela");
  await book(3, farmer, 90, "requested", "Pelawatta");
  await book(5, neighbours[5], 250, "picked_up", "Thalawathugoda");
  console.log(`Created ${DRIVERS.length} demo drivers/lorries (8 around Battaramulla, 2 near Kandy) with cargo bookings.`);

  // ---------- 5. return-load trips ----------
  await ReturnTrip.create([
    { driver: drivers[0]._id, vehicleRegistrationNo: "WP CBA-5521", fromHub: "Dambulla", toDistrict: "Colombo", departAt: hoursFromNow(6), availableKg: 1400, pricePerKg: 9, regularPricePerKg: 18, note: "Heading back to the Colombo side after the Dambulla run. Can collect around Battaramulla / Malabe." },
    { driver: drivers[1]._id, vehicleRegistrationNo: "WP LH-3908", fromHub: "Colombo_Manning_Market", toDistrict: "Gampaha", departAt: hoursFromNow(14), availableKg: 900, pricePerKg: 8, regularPricePerKg: 15, note: "Empty after Manning Market delivery." },
    { driver: drivers[2]._id, vehicleRegistrationNo: "WP PC-7746", fromHub: "Pettah", toDistrict: "Kurunegala", departAt: hoursFromNow(22), availableKg: 2600, pricePerKg: 10, regularPricePerKg: 21 },
    { driver: drivers[3]._id, vehicleRegistrationNo: "WP KT-1184", fromHub: "Colombo_Manning_Market", toDistrict: "Kalutara", departAt: hoursFromNow(10), availableKg: 700, pricePerKg: 7, regularPricePerKg: 13, note: "Along the A8 via Panadura." },
    { driver: drivers[4]._id, vehicleRegistrationNo: "WP LD-9025", fromHub: "Kandy", toDistrict: "Colombo", departAt: hoursFromNow(30), availableKg: 3100, pricePerKg: 12, regularPricePerKg: 24, note: "Kandy to Colombo, empty on the way down - good for hill-country produce going to Manning." },
    { driver: drivers[7]._id, vehicleRegistrationNo: "WP KR-6073", fromHub: "Other", toDistrict: "Ratnapura", departAt: hoursFromNow(40), availableKg: 4200, pricePerKg: 11, regularPricePerKg: 22, note: "From Meegoda Economic Centre." },
    { driver: drivers[5]._id, vehicleRegistrationNo: "NW LC-2217", fromHub: "Pettah", toDistrict: "Colombo", departAt: hoursFromNow(4), availableKg: 1800, pricePerKg: 6, regularPricePerKg: 12, note: "Quick local run, Pettah to Kaduwela / Battaramulla side." },
  ]);

  // ---------- 6. suppliers & rentals near Battaramulla (fictional) ----------
  const sup = (businessName, supplierType, place, i, address, district, phone, extra) => ({
    businessName, supplierType, location: point(near(PLACES[place], i)), address, district, contactPhone: phone, isVerified: true, createdBy: buyer._id, ...extra,
  });
  await LocalSupplier.insertMany([
    sup("Pelawatta Agro Mart", "seed_store", "Pelawatta", 1, "Pelawatta Road, Battaramulla", "Colombo", "+94110000101", { itemsAvailable: ["okra seeds", "brinjal seeds", "chili seeds", "snake gourd seeds", "seedling trays", "compost"] }),
    sup("Malabe Green Supplies", "fertilizer_store", "Malabe", 2, "Malabe Town, Kaduwela Road", "Colombo", "+94110000102", { itemsAvailable: ["urea", "TSP", "MOP", "organic compost", "neem-based sprays", "lime"] }),
    sup("Battaramulla Garden & Tool House", "tool_store", "Battaramulla", 3, "Main Street, Battaramulla", "Colombo", "+94110000103", { itemsAvailable: ["sprayers", "hoes", "pruning shears", "irrigation pipes", "drip kits", "gloves"] }),
    sup("Thalawathugoda Farm Machinery Rentals", "equipment_rental", "Thalawathugoda", 4, "Thalawathugoda Road", "Colombo", "+94110000104", { rentalEquipment: [{ equipmentName: "Two-wheel tractor", dailyRateLkr: 4800 }, { equipmentName: "Power sprayer", dailyRateLkr: 1500 }, { equipmentName: "Water pump (3 inch)", dailyRateLkr: 2200 }] }),
    sup("Kotte Organic Compost Centre", "fertilizer_store", "Kotte", 5, "Kotte Road, Sri Jayawardenepura Kotte", "Colombo", "+94110000105", { itemsAvailable: ["compost", "cow-dung manure", "vermicompost", "coir dust", "bio-fertilizer"] }),
    sup("Nawala Seeds & Nursery", "seed_store", "Nawala", 6, "Nawala Road", "Colombo", "+94110000106", { itemsAvailable: ["vegetable seedlings", "papaya plants", "banana suckers", "grow bags", "potting mix"] }),
    sup("Kaduwela Sprayer & Pump Hire", "equipment_rental", "Kaduwela", 7, "Kaduwela Junction", "Colombo", "+94110000107", { rentalEquipment: [{ equipmentName: "Knapsack sprayer", dailyRateLkr: 600 }, { equipmentName: "Brush cutter", dailyRateLkr: 1800 }, { equipmentName: "Water pump (2 inch)", dailyRateLkr: 1600 }] }),
    sup("Rajagiriya Irrigation Supplies", "tool_store", "Rajagiriya", 8, "Sri Jayawardenepura Mawatha, Rajagiriya", "Colombo", "+94110000108", { itemsAvailable: ["drip lines", "sprinklers", "PVC pipes", "tanks", "mulch sheets"] }),
    sup("Homagama Agro Centre", "seed_store", "Homagama", 9, "Homagama Town", "Colombo", "+94110000109", { itemsAvailable: ["bean seeds", "cucumber seeds", "cabbage seeds", "fertilizer", "pesticides"] }),
  ]);
  console.log("Created 9 nearby suppliers and rentals.");

  // ---------- 7. agriculture offices (Colombo) ----------
  await AgriOffice.create([
    // REAL entry - source: agrimin.gov.lk contact page (Secretary's Office), checked when this script was written.
    { name: "Ministry of Agriculture - Head Office", kind: "government_office", district: "Colombo", phone: "+94112034300", address: "80/5, Govijana Mandiraya, Rajamalwatta Lane, Battaramulla", hours: "Government office hours", isSample: false },
    { name: "Sample Agrarian Service Centre (Kaduwela area)", kind: "agrarian_service_centre", district: "Colombo", phone: "", address: "Replace with the real address", hours: "Mon-Fri 8:30-4:15", isSample: true },
    { name: "Sample Agriculture Extension Officer (Battaramulla)", kind: "extension_officer", district: "Colombo", phone: "", address: "Replace with the real details", isSample: true },
    { name: "Sample Cooperative Society (Homagama)", kind: "cooperative", district: "Colombo", phone: "", address: "Replace with the real details", isSample: true },
    { name: "Sample Agrarian Service Centre (Gampaha)", kind: "agrarian_service_centre", district: "Gampaha", phone: "", address: "Replace with the real address", isSample: true },
  ]);

  // ---------- 8. the demo farmer's marketplace, history and money ----------
  const seg = ["supermarket", "hotel", "exporter"];
  const sold = [
    ["Okra (Bandakka)", 160, 248, 50], ["Okra (Bandakka)", 180, 255, 36], ["Okra (Bandakka)", 140, 262, 22], ["Okra (Bandakka)", 200, 270, 9],
    ["Brinjal (Eggplant)", 150, 195, 46], ["Brinjal (Eggplant)", 170, 205, 28], ["Brinjal (Eggplant)", 120, 214, 11],
    ["Snake Gourd", 90, 160, 40], ["Snake Gourd", 110, 170, 20], ["Snake Gourd", 100, 178, 6],
    ["Chili", 40, 455, 30], ["Chili", 50, 480, 12],
  ];
  await MarketplaceListing.insertMany(sold.map(([cropType, kg, price, ago], i) => ({
    farmer: farmer._id, cropType, quantityKg: kg, originalPricePerKg: price, currentPricePerKg: price, agreedPricePerKg: price,
    harvestDate: daysAgo(ago + 2), qualityGrade: "A", tier: "primary", targetBuyerSegment: seg, status: "sold", orderedBy: i % 2 ? buyer2._id : buyer._id,
    soldAt: daysAgo(ago), createdAt: daysAgo(ago + 3), updatedAt: daysAgo(ago),
  })));
  const live = (cropType, quantityKg, price, harvestAgo, grade = "A", extra = {}) => MarketplaceListing.create({
    farmer: farmer._id, cropType, quantityKg, originalPricePerKg: price, currentPricePerKg: price, harvestDate: daysAgo(harvestAgo), qualityGrade: grade,
    tier: "primary", status: "listed", targetBuyerSegment: seg, ...extra,
  });
  await live("Okra (Bandakka)", 220, 270, 0.3);
  await live("Brinjal (Eggplant)", 150, 215, 1);
  await live("Snake Gourd", 120, 175, 1);
  await live("Bitter Gourd", 80, 310, 0.5);
  await live("Banana", 300, 155, 2);
  await live("Chili", 60, 500, 0.5);
  await live("Cucumber", 110, 115, 4, "B");
  await MarketplaceListing.create({
    farmer: farmer._id, cropType: "Papaya", quantityKg: 140, originalPricePerKg: 130, currentPricePerKg: 104, markdownPercentApplied: 20,
    harvestDate: daysAgo(1), qualityGrade: "B", tier: "secondary", status: "listed", targetBuyerSegment: ["factory", "restaurant", "compost_hub"],
    rejectionHistory: [{ rejectedBy: buyer._id, reason: "Uneven ripeness for hotel buffet", defectType: "underripe", rejectedAt: daysAgo(1) }],
  });
  await MarketplaceListing.create({
    farmer: farmer._id, cropType: "Pumpkin", quantityKg: 180, originalPricePerKg: 100, currentPricePerKg: 100, agreedPricePerKg: 100,
    harvestDate: daysAgo(2), qualityGrade: "A", tier: "primary", status: "reserved", orderedBy: buyer._id, targetBuyerSegment: seg,
  });

  const ledger = [
    ["expense", "seeds", 12500, 70, "Okra and brinjal seed"], ["expense", "fertilizer", 16800, 62, "Compost + top dressing"], ["expense", "labour", 28000, 55, "Bed preparation and planting"],
    ["expense", "pesticide", 6400, 38, "Neem spray x3"], ["expense", "water", 4200, 30, "Pump electricity"], ["expense", "transport", 5200, 12, "Truck to Manning Market"],
    ["income", "sale", 112000, 9, "Okra to Lakeside Hotels"], ["income", "sale", 44000, 11, "Brinjal to Colombo Fresh"], ["expense", "labour", 18000, 8, "Harvest labour"],
    ["income", "sale", 17800, 6, "Snake gourd to Colombo Fresh"],
  ];
  await LedgerEntry.insertMany(ledger.map(([type, category, amountLkr, ago, note]) => ({ farmer: farmer._id, cropType: "Okra (Bandakka)", type, category, amountLkr, note, date: daysAgo(ago) })));
  await YieldRecord.insertMany([
    { farmer: farmer._id, cropType: "Okra (Bandakka)", season: "maha", year: new Date().getFullYear() - 1, acres: 0.8, harvestKg: 3600, district: "Colombo" },
    { farmer: farmer._id, cropType: "Brinjal (Eggplant)", season: "yala", year: new Date().getFullYear() - 1, acres: 0.5, harvestKg: 4200, district: "Colombo" },
  ]);
  await CrowdfundingCampaign.create([
    { farmer: farmer._id, timelineRef: "bt-demo-okra", cropType: "Okra (Bandakka)", description: "Drip irrigation and netting for a half-acre okra plot near Pelawatta.", fundingGoalLkr: 120000, amountRaisedLkr: 78000, returnPercentage: 11, deadline: daysFromNow(35), status: "open",
      pledges: [{ investor: buyer._id, amountLkr: 50000, expectedReturnLkr: 55500, status: "pledged", pledgedAt: daysAgo(6) }, { investor: buyer2._id, amountLkr: 28000, expectedReturnLkr: 31080, status: "pledged", pledgedAt: daysAgo(2) }] },
    { farmer: farmer._id, timelineRef: "bt-demo-brinjal-last", cropType: "Brinjal (Eggplant)", description: "Last season's brinjal crop - funded and repaid on time.", fundingGoalLkr: 45000, amountRaisedLkr: 45000, returnPercentage: 10, deadline: daysAgo(25), status: "repaid",
      pledges: [{ investor: buyer._id, amountLkr: 45000, expectedReturnLkr: 49500, status: "repaid", pledgedAt: daysAgo(80) }] },
  ]);

  // ---------- 9. group lots + buyer demand board (Colombo) ----------
  const n = (i) => neighbours[i - 1];
  await GroupLot.create([
    { cropType: "Okra (Bandakka)", district: "Colombo", targetKg: 500, pricePerKg: 255, pickupNote: "Battaramulla junction, 6am", createdBy: n(1)._id, members: [{ farmer: n(1)._id, quantityKg: 150 }, { farmer: n(3)._id, quantityKg: 120 }, { farmer: farmer._id, quantityKg: 100 }], committedKg: 370, status: "open", closesAt: daysFromNow(3) },
    { cropType: "Brinjal (Eggplant)", district: "Colombo", targetKg: 300, pricePerKg: 205, pickupNote: "Malabe town, near the bus stand", createdBy: n(8)._id, members: [{ farmer: n(8)._id, quantityKg: 150 }, { farmer: n(9)._id, quantityKg: 150 }], committedKg: 300, status: "full", closesAt: daysFromNow(2) },
    { cropType: "Snake Gourd", district: "Colombo", targetKg: 250, pricePerKg: 170, pickupNote: "Kaduwela junction", createdBy: n(2)._id, members: [{ farmer: n(2)._id, quantityKg: 60 }], committedKg: 60, status: "open", closesAt: daysFromNow(5) },
    { cropType: "Banana", district: "Colombo", targetKg: 400, pricePerKg: 150, pickupNote: "Thalawathugoda Road", createdBy: n(6)._id, members: [{ farmer: n(6)._id, quantityKg: 200 }, { farmer: n(11)._id, quantityKg: 200 }], committedKg: 400, status: "claimed", claimedBy: buyer2._id, claimedAt: daysAgo(4), closesAt: daysAgo(4) },
  ]);
  await DemandRequest.create([
    { buyer: buyer._id, cropType: "Okra (Bandakka)", quantityKg: 300, maxPricePerKg: 285, neededBy: daysFromNow(5), district: "Colombo", note: "Fresh, Grade A. Delivery to our Colombo 07 kitchen.",
      offers: [{ farmer: n(1)._id, quantityKg: 120, pricePerKg: 270, message: "Can deliver Tuesday morning." }] },
    { buyer: buyer._id, cropType: "Snake Gourd", quantityKg: 150, maxPricePerKg: 190, neededBy: daysFromNow(7), district: "Colombo", note: "Weekly standing order, starts this week." },
    { buyer: buyer2._id, cropType: "Banana", quantityKg: 500, maxPricePerKg: 165, neededBy: daysFromNow(10), district: "Colombo", note: "For our supermarket chain, Embul variety preferred." },
    { buyer: buyer2._id, cropType: "Brinjal (Eggplant)", quantityKg: 250, maxPricePerKg: 225, neededBy: daysFromNow(4), district: "Colombo", note: "Medium size, uniform." },
    { buyer: buyer2._id, cropType: "Chili", quantityKg: 80, maxPricePerKg: 520, neededBy: daysFromNow(6), district: "", note: "Any district." },
    { buyer: buyer._id, cropType: "Pumpkin", quantityKg: 300, maxPricePerKg: 115, neededBy: daysFromNow(2), district: "Colombo", status: "fulfilled", fulfilledKg: 300,
      offers: [{ farmer: farmer._id, quantityKg: 200, pricePerKg: 100, status: "accepted", acceptedKg: 200 }, { farmer: n(7)._id, quantityKg: 100, pricePerKg: 102, status: "accepted", acceptedKg: 100 }] },
  ]);

  console.log("\nDONE. Battaramulla demo logins:");
  console.log(`  Farmer : ${FARMER_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Buyer  : ${BUYER_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Driver : ${DRIVER_EMAILS[0]} / ${DEMO_PASSWORD}   (demo.driver1 ... demo.driver10)`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error("Seed failed:", e);
  try { await mongoose.disconnect(); } catch (_) { /* ignore */ }
  process.exit(1);
});
