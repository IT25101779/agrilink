// Tests for: Profit Planner, Loan Readiness, admin Impact Dashboard, admin Market Heatmap — over real HTTP on the freshly seeded DB.
const assert = require("assert"); const mongoose = require("mongoose");
const BASE = "http://127.0.0.1:5055/api"; let passed = 0; const ok = (m) => console.log(`  ok ${++passed}. ${m}`);
const { autoToken } = require("./test_identity");
async function http(method, path, { token, body } = {}) {
  token = token || autoToken(path, body);
  const res = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (_) {} return { status: res.status, body: json, text };
}
const login = async (email, password = "Demo@1234") => { const r = await http("POST", "/auth/login", { body: { email, password } }); assert.equal(r.status, 200, "login " + email + " " + r.text); return { token: r.body.data.token, id: r.body.data.user.id }; };
(async () => {
  const User = require("./models/User"); await mongoose.connect("mongodb://127.0.0.1:27017/agrilink_e2e");
  await User.deleteMany({ email: "admin.test@agrilink.lk" }); await User.create({ fullName: "Admin Test", email: "admin.test@agrilink.lk", phone: "+94770000001", passwordHash: await User.hashPassword("Admin@1234"), role: "admin" });
  const F = await login("demo.farmer@agrilink.lk"), B = await login("demo.buyer@agrilink.lk"), A = await login("admin.test@agrilink.lk", "Admin@1234"); ok("logged in as farmer, buyer and a test admin");

  // ================= PROFIT PLANNER =================
  assert.equal((await http("GET", "/insights/profit-plan/Tomato")).status, 401); ok("profit plan needs login (401)");
  let r = await http("GET", "/insights/profit-plan/Tomato?acres=2", { token: F.token }); assert.equal(r.status, 200); let p = r.body.data;
  assert.equal(p.supported, true); assert.equal(p.acres, 2); assert.equal(p.assumptions.priceSource, "forecast"); assert.ok(p.scenarios.expected.profitLkr !== undefined); assert.equal(p.saturationLevel, "high"); assert.ok(p.riskNotes.some((x) => /Many farmers/.test(x)));
  assert.ok(p.scenarios.low.profitLkr < p.scenarios.expected.profitLkr && p.scenarios.expected.profitLkr < p.scenarios.high.profitLkr);
  console.log(`      Tomato 2 acres in Kandy: price LKR ${p.assumptions.expectedPricePerKg}/kg at harvest, expected profit LKR ${p.scenarios.expected.profitLkr.toLocaleString()} (${p.scenarios.expected.roiPercent}% ROI), range ${p.scenarios.low.profitLkr.toLocaleString()} to ${p.scenarios.high.profitLkr.toLocaleString()}, verdict ${p.verdict}, break-even LKR ${p.breakEvenPricePerKg}/kg`);
  ok("Tomato plan: uses real sold-price forecast, low<expected<high, and warns that Kandy is crowded (uses the district signal)");
  r = await http("GET", "/insights/profit-plan/Mango", { token: F.token }); assert.equal(r.body.data.supported, false); ok("perennial crop refused politely");
  r = await http("GET", "/insights/profit-plan/Leeks?acres=1", { token: F.token }); assert.equal(r.body.data.verdict, "needs_price"); assert.equal(r.body.data.scenarios, null); ok("crop with no price data -> asks the farmer for a price instead of guessing");
  r = await http("GET", "/insights/profit-plan/Leeks?acres=1&pricePerKg=210&yieldKgPerAcre=5000&costPerAcre=380000", { token: F.token }); assert.notEqual(r.body.data.verdict, "needs_price"); assert.equal(r.body.data.assumptions.yieldIsEdited, true); assert.equal(r.body.data.assumptions.costIsEdited, true); ok("...and recalculates with the farmer's own price / yield / cost");
  for (const bad of ["acres=0", "acres=abc", "acres=500", "yieldKgPerAcre=-5", "costPerAcre=abc"]) assert.equal((await http("GET", `/insights/profit-plan/Tomato?${bad}`, { token: F.token })).status, 400); ok("invalid inputs rejected (acres 0/abc/500, negative yield, text cost)");

  // ================= LOAN READINESS =================
  r = await http("GET", "/passport/me", { token: F.token }); const pp = r.body.data; let rd = pp.passport.readiness;
  assert.equal(rd.total, 8); assert.equal(rd.passed, 7); assert.equal(rd.percent, 88); assert.equal(rd.level, "loan_ready"); const missing = rd.checks.filter((c) => !c.met).map((c) => c.id); assert.deepEqual(missing, ["community"]);
  console.log("      checks: " + rd.checks.map((c) => `${c.met ? "PASS" : "----"} ${c.id} (${c.current}/${c.target})`).join(" | "));
  ok("demo farmer: 7 of 8 checks (88%, loan-ready) — only the group sale is missing");
  const html = await (await fetch(pp.shareUrl)).text(); assert.ok(html.includes("Loan readiness") && html.includes("7 of 8 checks") && html.includes("Complete one group sale")); ok("the PUBLIC lender page shows the readiness checklist");
  // complete the group sale live: join the Carrot lot, buyer claims it
  const lots = await http("GET", "/group-lots?district=Kandy", { token: F.token }); const carrot = lots.body.data.find((l) => l.cropType === "Carrot");
  await http("POST", `/group-lots/${carrot._id}/join`, { token: F.token, body: { quantityKg: 120 } }); r = await http("POST", `/group-lots/${carrot._id}/claim`, { token: B.token }); assert.equal(r.status, 200);
  rd = (await http("GET", "/passport/me", { token: F.token })).body.data.passport.readiness; assert.equal(rd.passed, 8); assert.equal(rd.percent, 100); ok("after joining a group lot that a buyer claims -> 8 of 8 checks (100%) — the live-demo moment works");
  const brandNew = await User.create({ fullName: "New Farmer", email: "brandnew.farmer@agrilink.lk", phone: "+94770000002", passwordHash: await User.hashPassword("Demo@1234"), role: "farmer", farmerProfile: { district: "Kandy" } });
  const NF = await login("brandnew.farmer@agrilink.lk"); rd = (await http("GET", "/passport/me", { token: NF.token })).body.data.passport.readiness; assert.equal(rd.level, "getting_started"); assert.ok(rd.passed <= 1); assert.ok(rd.checks.every((c) => typeof c.tip === "string" && c.tip.length > 5)); ok(`a brand-new farmer is 'getting started' (${rd.passed}/8) and every check has a tip`);
  await User.deleteOne({ _id: brandNew._id });

  // ================= IMPACT DASHBOARD =================
  assert.equal((await http("GET", "/admin/impact")).status, 401); assert.equal((await http("GET", "/admin/impact", { token: F.token })).status, 403); assert.equal((await http("GET", "/admin/market-heatmap", { token: B.token })).status, 403); ok("admin endpoints: no token 401, farmer/buyer 403");
  r = await http("GET", "/admin/impact", { token: A.token }); assert.equal(r.status, 200); const im = r.body.data;
  assert.equal(im.users.farmers, 38); assert.equal(im.users.buyers, 2); ok("users: 38 farmers (1 demo + 12 + 25 district farmers), 2 buyers");
  // hand-calculated from the seed: 13 primary sales (3600 kg, LKR 654,500) + 3 rescued (650 kg, LKR 77,500)
  assert.equal(im.sales.completed, 16); assert.equal(im.sales.kgSold, 4250); assert.equal(im.sales.valueLkr, 732000); ok("sales: 16 sales, 4,250 kg, LKR 732,000 — matches my hand calculation from the seed");
  assert.equal(im.wasteRescued.kgRescued, 650); assert.equal(im.wasteRescued.valueLkr, 77500); assert.equal(im.wasteRescued.rescuedSales, 3); assert.equal(im.wasteRescued.listingsRedirected, 4); assert.equal(im.wasteRescued.kgWaitingOnFlashSale, 240); ok("waste rescued: 650 kg (LKR 77,500) sold after buyer rejection; 240 kg still on flash sale");
  assert.equal(im.groupSelling.lotsClaimed, 2); assert.equal(im.groupSelling.kgPooled, 800); assert.ok(im.groupSelling.farmersParticipating >= 4); assert.ok(im.groupSelling.smallFarmersReachingBulkBuyers >= 2); ok(`group selling: 2 lots claimed (the seeded Cabbage lot + the Carrot lot just claimed), 800 kg, ${im.groupSelling.smallFarmersReachingBulkBuyers} small farmers reached bulk buyers`);
  assert.equal(im.demandBoard.requestsPosted, 4); assert.equal(im.demandBoard.requestsOpen, 3); assert.equal(im.demandBoard.kgRequested, 1200); assert.equal(im.demandBoard.kgFulfilled, 200); assert.equal(im.demandBoard.offersReceived, 3); assert.equal(im.demandBoard.offersAccepted, 2); ok("demand board: 4 requests, 1,200 kg asked, 200 kg fulfilled, 3 offers (2 accepted)");
  assert.equal(im.funding.campaigns, 3); assert.equal(im.funding.campaignsFunded, 2); assert.equal(im.funding.raisedLkr, 90000); assert.equal(im.funding.campaignsRepaid, 1); assert.equal(im.funding.investors, 1); ok("funding: 3 campaigns, 2 funded (LKR 90,000), 1 repaid, 1 investor");
  assert.equal(im.diseaseWatch.scans, 6); assert.equal(im.diseaseWatch.outbreakReports, 6); assert.equal(im.diseaseWatch.districtsWithOutbreaks, 1); assert.equal(im.farming.activeTimelines, 83); assert.ok(im.farming.acresUnderManagement > 50); ok("disease watch: 6 outbreak reports in 1 district; farming: 83 active crops under management");
  assert.equal(im.weekly.length, 8); assert.equal(im.weekly.reduce((t, w) => t + w.valueLkr, 0), 732000); assert.ok(im.weekly.every((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.weekEnding))); ok("weekly trend: 8 weeks whose values add up exactly to total sales (nothing lost or double-counted)");

  // ================= MARKET HEATMAP =================
  r = await http("GET", "/admin/market-heatmap", { token: A.token }); assert.equal(r.status, 200); const hm = r.body.data; const dist = (n) => hm.districts.find((d) => d.district === n);
  assert.equal(hm.districts.length, 8); assert.ok(["Kandy", "Nuwara Eliya", "Anuradhapura", "Kurunegala", "Badulla", "Jaffna", "Galle", "Matale"].every((n) => dist(n))); ok("8 districts on the map");
  assert.equal(dist("Kandy").totalPlantings, 15); assert.equal(dist("Kandy").crops[0].cropType, "Tomato"); assert.equal(dist("Kandy").crops[0].level, "high"); ok("Kandy: 15 plantings, Tomato is the crowded crop (same numbers the farmer app shows)");
  const spots = hm.hotspots.map((h) => `${h.district}/${h.cropType}`).sort(); assert.deepEqual(spots, ["Anuradhapura/Paddy (Rice)", "Badulla/Tomato", "Jaffna/Chili", "Jaffna/Onion (Big/Red)", "Kandy/Tomato", "Kurunegala/Brinjal (Eggplant)", "Nuwara Eliya/Carrot"].sort()); console.log("      hotspots: " + spots.join(", ")); ok("7 hotspots found; quiet districts (Galle) and data-poor ones (Matale) raise no alarm");
  assert.equal(dist("Matale").enoughData, false); assert.equal(dist("Galle").crops.every((c) => c.level === "low"), true); ok("Matale (2 plantings) marked 'not enough data'; Galle all green");
  assert.equal(hm.topCrops[0].cropType, "Tomato"); assert.ok(hm.topCrops.length <= 10); assert.ok(hm.demand.some((d) => d.cropType === "Pumpkin" && d.kgNeeded === 500)); ok("top crops ranked (Tomato first, max 10 columns); open buyer demand included (Pumpkin 500 kg)");
  assert.ok(!JSON.stringify(hm).match(/Bandara|Perera|@/), "no personal data"); ok("the heatmap contains no names or emails — aggregate counts only");
  await User.deleteOne({ email: "admin.test@agrilink.lk" }); await mongoose.disconnect();
  console.log(`\nALL ${passed} NEW-FEATURE END-TO-END TESTS PASSED`);
})().catch(async (e) => { console.error("\nFAILED:", e.message); console.error((e.stack || "").split("\n").slice(1, 4).join("\n")); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
