// Full-stack test: the REAL server.js (Express + Mongoose + JWT) over real HTTP, on the seeded demo database.
const assert = require("assert");
const BASE = "http://127.0.0.1:5055/api";
let passed = 0; const ok = (m) => console.log(`  ok ${++passed}. ${m}`);
const { autoToken } = require("./test_identity");
async function http(method, path, { token, body, raw } = {}) {
  token = token || autoToken(path, body);
  const res = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return res;
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, body: json, text };
}
const login = async (email) => { const r = await http("POST", "/auth/login", { body: { email, password: "Demo@1234" } }); assert.equal(r.status, 200, "login " + email + ": " + r.text); return { token: r.body.data ? r.body.data.token : r.body.token, id: (r.body.data ? r.body.data.user : r.body.user).id }; };

(async () => {
  assert.equal((await http("GET", "/health")).status, 200); ok("server up, /health");
  const F = await login("demo.farmer@agrilink.lk"); const B = await login("demo.buyer@agrilink.lk"); const N1 = await login("neighbour1@neighbour.demo.agrilink.lk"); ok("logged in as demo farmer, demo buyer, a neighbour");

  // ---------- AUTH / ROLE GUARDS ----------
  for (const [m, p] of [["GET", "/insights/planting-signals"], ["GET", "/insights/price-forecast/Tomato"], ["GET", "/insights/sell-or-hold"], ["POST", "/insights/price-alerts/generate"], ["GET", "/group-lots"], ["POST", "/group-lots"], ["GET", "/demand"], ["POST", "/demand"], ["GET", "/passport/me"], ["POST", "/passport/rotate"]]) assert.equal((await http(m, p)).status, 401, `${m} ${p} should need login`);
  ok("all 10 new protected routes reject requests with no token (401)");
  assert.equal((await http("POST", "/group-lots", { token: B.token, body: { cropType: "Carrot", targetKg: 100, pricePerKg: 200, quantityKg: 10 } })).status, 403); assert.equal((await http("POST", "/demand", { token: F.token, body: { cropType: "Carrot", quantityKg: 10, maxPricePerKg: 200, neededBy: new Date(Date.now() + 9e8).toISOString() } })).status, 403); assert.equal((await http("GET", "/passport/me", { token: B.token })).status, 403); assert.equal((await http("POST", "/group-lots/000000000000000000000000/claim", { token: F.token })).status, 403);
  ok("role guards: buyer can't create lots / farmer can't post demand / buyer has no passport / farmer can't claim");

  // ---------- OVERSUPPLY GUARD ----------
  let r = await http("GET", "/insights/planting-signals", { token: F.token }); assert.equal(r.status, 200); const sig = r.body.data;
  assert.equal(sig.district, "Kandy"); assert.equal(sig.enoughData, true); assert.equal(sig.totalPlantings, 15); assert.equal(sig.totalFarmers, 8);
  const tomato = sig.crops.find((c) => c.cropType === "Tomato"), beans = sig.crops.find((c) => c.cropType === "Beans (Bush)"), carrot = sig.crops.find((c) => c.cropType === "Carrot");
  assert.equal(tomato.farmers, 7); assert.equal(tomato.level, "high"); assert.equal(beans.level, "medium"); assert.equal(carrot.level, "low");
  console.log(`      Kandy: Tomato ${tomato.farmers} farmers ${tomato.sharePercent}% => ${tomato.level} | Beans ${beans.farmers} farmers ${beans.sharePercent}% => ${beans.level} | Carrot ${carrot.farmers} => ${carrot.level}`);
  ok("Oversupply Guard: Tomato HIGH, Beans MEDIUM, Carrot LOW — district taken from the farmer's profile"); 
  assert.ok(!JSON.stringify(sig).includes("Bandara"), "no farmer names leak"); ok("only anonymous counts leave the server (no names)");
  r = await http("GET", "/insights/planting-signals?district=Matale", { token: F.token }); assert.equal(r.body.data.enoughData, false); assert.equal(r.body.data.crops.every((c) => c.level === "low"), true); ok("district with too little data (Matale: 2 plantings) refuses to raise an alarm");
  const d = sig.demand.map((x) => x.cropType).sort(); assert.deepEqual(d, ["Beans (Bush)", "Carrot", "Pumpkin"]); assert.equal(sig.demand.find((x) => x.cropType === "Pumpkin").totalKg, 500); ok("open buyer demand is included alongside supply (Beans, Carrot, Pumpkin)");

  // ---------- PRICE FORECAST ----------
  r = await http("GET", "/insights/price-forecast/Tomato?weeks=12", { token: F.token }); assert.equal(r.status, 200); const fc = r.body.data;
  assert.equal(fc.points.length, 13); assert.equal(fc.method, "rule_based"); assert.equal(fc.baselineSource, "sold_history"); assert.ok(fc.todayPricePerKg > 120 && fc.todayPricePerKg < 240);
  assert.ok(fc.points.some((p) => p.event), "12 weeks from mid-Sept should reach Deepavali/Christmas");
  console.log(`      Tomato today LKR ${fc.todayPricePerKg}; peak LKR ${fc.peak.pricePerKg} (${fc.peak.changePercent}%) ${fc.peak.event || ""}; confidence ${fc.confidence}; drivers: ${fc.drivers.map((x) => x.label + " " + x.impactPercent + "%").join(" | ")}`);
  ok("forecast: 13 weekly points, rule-based label, real sold-history baseline, festival visible");
  r = await http("GET", "/insights/price-forecast/Tomato?weeks=999", { token: F.token }); assert.equal(r.body.data.points.length, 17); ok("weeks is clamped (999 -> 16)");
  r = await http("GET", "/insights/price-forecast/Dragonfruit", { token: F.token }); assert.equal(r.status, 200); assert.equal(r.body.data.baselineSource, "no_data_flat_default"); ok("unknown crop still answers safely (flat default, low confidence)");

  // ---------- FRESHNESS CLOCK ----------
  r = await http("GET", `/marketplace/listings?farmer=${F.id}&status=listed`); assert.equal(r.status, 200); const mine = r.body.data;
  const by = (c) => mine.find((l) => l.cropType === c);
  assert.equal(by("Okra (Bandakka)").freshness.label, "expired"); assert.equal(by("Tomato").freshness.label, "fresh"); assert.equal(by("Beans (Bush)").freshness.label, "fresh"); assert.equal(by("Brinjal (Eggplant)").freshness.label, "aging");
  assert.ok(by("Brinjal (Eggplant)").freshness.effectivePricePerKg < 140);
  console.log("      " + mine.map((l) => `${l.cropType}: ${l.freshness.label} ${l.freshness.percentRemaining}% -> LKR ${l.freshness.effectivePricePerKg} (asked ${l.currentPricePerKg})`).join("\n      "));
  ok("every listing carries live freshness: Okra expired, Tomato/Beans fresh, Brinjal aging with a lower live price");
  r = await http("PATCH", `/marketplace/listings/${by("Okra (Bandakka)")._id}/confirm-order`, { body: { buyerId: B.id } }); assert.equal(r.status, 409); assert.match(r.body.message, /freshness window/); ok("buyer cannot buy EXPIRED primary produce (409, points to Secondary Market)");
  const brinjal = by("Brinjal (Eggplant)"); r = await http("PATCH", `/marketplace/listings/${brinjal._id}/confirm-order`, { body: { buyerId: B.id } }); assert.equal(r.status, 200); assert.equal(r.body.data.agreedPricePerKg, brinjal.freshness.effectivePricePerKg); ok(`confirming an ageing listing locks today's live price (LKR ${r.body.data.agreedPricePerKg}/kg, not the LKR 140 asking)`);
  r = await http("PATCH", `/marketplace/listings/${brinjal._id}/complete-sale`, { body: { confirmedBy: B.id } }); assert.equal(r.status, 200); assert.equal(r.body.data.status, "sold"); assert.equal(r.body.data.currentPricePerKg, brinjal.freshness.effectivePricePerKg); ok("completing the sale records the REAL freshness-adjusted price as the sold price");
  r = await http("PATCH", `/marketplace/listings/${brinjal._id}/confirm-order`, { body: { buyerId: B.id } }); assert.equal(r.status, 409); ok("same listing can't be bought twice");

  // ---------- SELL-OR-HOLD ----------
  r = await http("GET", "/insights/sell-or-hold", { token: F.token }); assert.equal(r.status, 200); const adv = r.body.data; const A = (c) => adv.find((a) => a.cropType === c);
  console.log("      " + adv.map((a) => `[${a.urgency}] ${a.cropType}: ${a.action} — ${a.headline}`).join("\n      "));
  assert.equal(A("Okra (Bandakka)").action, "sell_now"); assert.equal(A("Okra (Bandakka)").urgency, "high"); assert.equal(adv[0].cropType, "Okra (Bandakka)", "most urgent first");
  assert.equal(A("Tomato").action, "sell_now"); assert.ok(A("Tomato").reasons.some((x) => /Many farmers/.test(x)), "tomato: oversupply reason");
  assert.equal(A("Beans (Bush)").action, "hold"); assert.ok(A("Beans (Bush)").holdUntil);
  assert.ok(!adv.some((a) => a.cropType === "Brinjal (Eggplant)"), "sold/reserved listings get no advice");
  ok("advice: Okra SELL NOW (expired, listed first) | Tomato SELL SOON (crowded Kandy) | Beans HOLD (rising prices, room in market)");
  const carrotAdvice = A("Carrot"); assert.equal(carrotAdvice.action, "steady"); assert.match(carrotAdvice.headline, /Flash sale/); ok("flash-sale carrot: neither 'underpriced' nor 'hold' — just 'priced to sell quickly'");

  // ---------- PRICE ALERTS -> REMINDERS ----------
  r = await http("POST", "/insights/price-alerts/generate", { token: F.token }); assert.equal(r.status, 200); const created = r.body.created; assert.ok(created >= 3); r = await http("POST", "/insights/price-alerts/generate", { token: F.token }); assert.equal(r.body.created, 0); ok(`alerts created (${created}), then re-running creates 0 (deduped per listing/action/day)`);
  r = await http("GET", `/reminders?farmer=${F.id}&status=pending`); assert.equal(r.status, 200); const alerts = r.body.data.filter((x) => x.type === "price_alert"); assert.equal(alerts.length, created); ok("they appear in the existing Reminders (bell icon) as type price_alert: " + alerts.map((a) => a.title).join(", "));

  // ---------- GROUP LOTS ----------
  r = await http("GET", "/group-lots?district=Kandy", { token: F.token }); assert.equal(r.status, 200); assert.equal(r.body.data.length, 3); const carrotLot = r.body.data.find((l) => l.cropType === "Carrot"), pumpkinLot = r.body.data.find((l) => l.cropType === "Pumpkin");
  assert.equal(carrotLot.remainingKg, 120); assert.equal(pumpkinLot.status, "full"); assert.ok(carrotLot.members.every((m) => !m.name.includes(" ")), "first names only"); ok("farmer sees 3 nearby lots (Carrot 380/500 open, Pumpkin full, Beans just started); members shown by first name only");
  r = await http("POST", `/group-lots/${carrotLot._id}/join`, { token: F.token, body: { quantityKg: 200 } }); assert.equal(r.status, 200); assert.equal(r.body.data.myQuantityKg, 120); assert.equal(r.body.data.status, "full"); ok("demo farmer joins the Carrot lot asking 200 kg -> capped to the 120 kg needed -> lot FULL");
  r = await http("POST", `/group-lots/${carrotLot._id}/claim`, { token: B.token }); assert.equal(r.status, 200); assert.equal(r.body.data.totalValueLkr, 112500); assert.ok(r.body.data.organizerPhone); assert.equal(r.body.data.shares.length, 3); console.log("      shares: " + r.body.data.shares.map((s) => `${s.name} ${s.quantityKg}kg=LKR ${s.amountLkr}`).join(", ")); ok("buyer claims it: 500 kg x LKR 225 = LKR 112,500 split by contribution");
  r = await http("POST", `/group-lots/${pumpkinLot._id}/claim`, { token: B.token }); assert.equal(r.status, 200); r = await http("GET", "/group-lots?status=claimed&claimedByMe=true", { token: B.token }); assert.equal(r.body.data.length, 2); ok("buyer's 'claimed' view lists both claimed lots");
  r = await http("POST", "/group-lots", { token: F.token, body: { cropType: "Tomato", targetKg: 400, pricePerKg: 190, quantityKg: 60, closesInDays: 3, pickupNote: "My gate" } }); assert.equal(r.status, 201); assert.equal(r.body.data.district, "Kandy"); ok("farmer creates a new lot (district from profile)");

  // ---------- DEMAND BOARD ----------
  r = await http("GET", "/demand", { token: F.token }); const reqs = r.body.data; assert.equal(reqs.length, 3); const carrotReq = reqs.find((q) => q.cropType === "Carrot"); const beansReq = reqs.find((q) => q.cropType === "Beans (Bush)"); assert.equal(beansReq.offersCount, 1); assert.equal(beansReq.myOffer, null); assert.equal(beansReq.buyerName, "Green Basket Hotels"); assert.ok(!JSON.stringify(reqs).includes("400"), "rival's LKR 400 offer price must be hidden");
  ok("farmer sees 3 open requests; Beans shows '1 offer' but the rival's price is hidden");
  r = await http("POST", `/demand/${carrotReq._id}/offers`, { token: F.token, body: { quantityKg: 150, pricePerKg: 250, message: "Fresh Nuwara Eliya-grade carrots" } }); assert.equal(r.status, 201); ok("farmer offers 150 kg Carrot @ LKR 250 (under the buyer's LKR 260 cap)");
  r = await http("GET", "/demand?mine=true", { token: B.token }); const mineReqs = r.body.data; const cReq = mineReqs.find((q) => q.cropType === "Carrot"); const bReq = mineReqs.find((q) => q.cropType === "Beans (Bush)"); assert.equal(cReq.offers.length, 1); assert.equal(cReq.offers[0].creditScore, 640); assert.equal(cReq.offers[0].farmerPhone, null); ok("buyer sees the offer with the farmer's credit score (640) but NO phone yet");
  r = await http("POST", `/demand/${bReq._id}/offers/${bReq.offers[0]._id}/accept`, { token: B.token }); assert.equal(r.status, 200); assert.equal(r.body.data.fulfilledKg, 120); assert.equal(r.body.data.remainingKg, 180); assert.ok(r.body.data.offers[0].farmerPhone); ok("buyer accepts neighbour's 120 kg Beans offer -> 120/300 covered, phone now visible");
  r = await http("GET", "/insights/planting-signals", { token: F.token }); assert.equal(r.body.data.demand.find((x) => x.cropType === "Beans (Bush)").totalKg, 180); ok("Crop Navigator demand signal updates live (Beans now needs 180 kg)");

  // ---------- FARM PASSPORT ----------
  r = await http("GET", "/passport/me", { token: F.token }); assert.equal(r.status, 200); const pp = r.body.data; assert.match(pp.shareUrl, /\/api\/passport\/view\/[a-f0-9]{24}$/); assert.match(pp.qrUrl, /\/api\/passport\/qr\/[a-f0-9]{24}$/);
  const s = pp.passport.stats; assert.equal(pp.passport.creditScore, 640); assert.equal(s.fundingRepaidCampaigns, 1); assert.equal(s.fundingRepaidLkr, 44000); assert.equal(s.fundingCampaignsFunded, 2); assert.equal(s.groupSalesCompleted, 1); assert.equal(s.groupKgContributed, 120); assert.ok(s.salesCompleted >= 14);
  console.log(`      passport ${pp.passport.passportId}: score ${pp.passport.creditScore} ${pp.passport.creditBand}, ${s.salesCompleted} sales, ${s.kgSold} kg, LKR ${s.salesValueLkr}, funded ${s.fundingCampaignsFunded} / repaid ${s.fundingRepaidCampaigns} (LKR ${s.fundingRepaidLkr}), group sales ${s.groupSalesCompleted}`);
  ok("passport aggregates sales, funding, repayment and group sales from real records");
  const tokenOld = pp.shareUrl.split("/").pop();
  const page = await fetch(pp.shareUrl); assert.equal(page.status, 200); assert.match(page.headers.get("content-type"), /html/); const html = await page.text(); assert.ok(html.includes("Nimal Perera") && html.includes("Farm Passport") && html.includes("not independently audited")); ok("PUBLIC web page opens with NO login and includes the honesty disclaimer");
  const qr = await fetch(pp.qrUrl); const buf = Buffer.from(await qr.arrayBuffer()); assert.equal(qr.status, 200); assert.equal(qr.headers.get("content-type"), "image/png"); assert.equal(buf.slice(1, 4).toString(), "PNG"); ok(`QR endpoint returns a real PNG (${buf.length} bytes)`);
  const js = await http("GET", `/passport/data/${tokenOld}`); assert.equal(js.status, 200); assert.equal(js.body.data.name, "Nimal Perera (Demo Farmer)"); ok("public JSON version works for lenders' systems");
  assert.equal((await fetch(BASE + "/passport/view/not-a-real-token")).status, 404); assert.equal((await fetch(BASE + "/passport/view/" + "a".repeat(24))).status, 404); assert.equal((await fetch(BASE + "/passport/qr/" + "b".repeat(24))).status, 404); ok("guessing links fails (malformed and well-formed unknown tokens -> 404)");
  r = await http("POST", "/passport/rotate", { token: F.token }); assert.equal(r.status, 200); assert.notEqual(r.body.data.shareUrl.split("/").pop(), tokenOld); assert.equal((await fetch(pp.shareUrl)).status, 404); assert.equal((await fetch(r.body.data.shareUrl)).status, 200); ok("ROTATE: the old shared link/QR dies instantly, the new one works");
  const Users = require("./models/User"); const mongoose = require("mongoose"); await mongoose.connect("mongodb://127.0.0.1:27017/agrilink_e2e"); await Users.updateOne({ _id: F.id }, { $set: { fullName: '<img src=x onerror=alert(1)> & "Co"' } }); const evil = await (await fetch(r.body.data.shareUrl)).text(); assert.ok(!evil.includes("<img src=x"), "raw HTML leaked!"); assert.ok(evil.includes("&lt;img src=x")); await mongoose.disconnect(); ok("XSS: a malicious farmer name is HTML-escaped on the public page");

  // ---------- EXISTING FLOW: crowdfunding repay (rewritten without $[] / pipeline update) ----------
  const camps = await http("GET", "/crowdfunding/campaigns?status=funded"); const funded = camps.body.data.find((c) => c.cropType === "Beans (Bush)"); assert.ok(funded);
  r = await http("PATCH", `/crowdfunding/campaigns/${funded._id}/repay`, { token: F.token }); assert.equal(r.status, 200); assert.equal(r.body.data.status, "repaid"); assert.ok(r.body.data.pledges.every((p) => p.status === "repaid"));
  r = await http("PATCH", `/crowdfunding/campaigns/${funded._id}/repay`, { token: F.token }); assert.equal(r.status, 409); ok("crowdfunding repay: all pledges repaid, second repay blocked (no double reward)");
  const me = await http("GET", "/auth/me", { token: F.token }); assert.equal(me.body.data.farmerProfile.creditScore, 665); assert.equal(me.body.data.farmerProfile.completedTimelinesCount, 3); ok("credit score 640 -> 665 (+25) and completed cycles 2 -> 3 — exactly once");
  console.log(`\nALL ${passed} END-TO-END TESTS PASSED`);
})().catch((e) => { console.error("\nFAILED:", e.message); console.error((e.stack || "").split("\n").slice(1, 4).join("\n")); process.exit(1); });
