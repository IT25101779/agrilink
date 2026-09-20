// SECURITY — the old endpoints used to trust "who am I" from the request body. Prove that is closed.
const assert = require("assert"); const mongoose = require("mongoose");
const BASE = "http://127.0.0.1:5055/api"; let passed = 0; const ok = (m) => console.log(`  ok ${++passed}. ${m}`);
async function http(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (_) {} return { status: res.status, body: json };
}
const login = async (email) => { const r = await http("POST", "/auth/login", { body: { email, password: "Demo@1234" } }); assert.equal(r.status, 200); return { token: r.body.data.token, id: r.body.data.user.id }; };
(async () => {
  const Listing = require("./models/MarketplaceListing"), Reminder = require("./models/Reminder"), Lorry = require("./models/LorryFleetTracking"), User = require("./models/User");
  await mongoose.connect("mongodb://127.0.0.1:27017/agrilink_e2e");
  const F = await login("demo.farmer@agrilink.lk"), B = await login("demo.buyer@agrilink.lk"), F1 = await login("neighbour1@neighbour.demo.agrilink.lk"), F2 = await login("neighbour2@neighbour.demo.agrilink.lk"), D = await login("demo.driver@agrilink.lk");
  const closed = [["GET", "/marketplace/listings"], ["POST", "/marketplace/listings"], ["PATCH", "/marketplace/listings/000000000000000000000001"], ["PATCH", "/marketplace/listings/000000000000000000000001/confirm-order"], ["GET", "/logistics/lorries/nearby?latitude=7&longitude=80"], ["POST", "/logistics/lorries"], ["GET", "/crowdfunding/campaigns"], ["POST", "/crowdfunding/campaigns"], ["GET", `/reminders?farmer=${F.id}`], ["GET", `/timelines/mine?farmerId=${F.id}`], ["GET", `/chat/history?farmer=${F.id}`], ["POST", "/chat/message"], ["POST", "/disease/scan"], ["GET", "/disease/outbreak-alerts?latitude=7&longitude=80"], ["GET", "/suppliers/nearby?latitude=7&longitude=80"], ["GET", "/community-listings/nearby?latitude=7&longitude=80"], ["POST", "/community-listings"]];
  for (const [m, p] of closed) assert.equal((await http(m, p, { body: m === "GET" ? undefined : {} })).status, 401, `${m} ${p}`);
  ok(`${closed.length} formerly-open endpoints now refuse anyone who is not logged in (401)`);

  // pretending to be someone else
  assert.equal((await http("GET", `/reminders?farmer=${F2.id}`, { token: F1.token })).status, 403); assert.equal((await http("GET", `/timelines/mine?farmerId=${F2.id}`, { token: F1.token })).status, 403); assert.equal((await http("GET", `/chat/history?farmer=${F2.id}`, { token: F1.token })).status, 403);
  assert.equal((await http("POST", "/marketplace/listings", { token: F1.token, body: { farmerId: F2.id, cropType: "Tomato", quantityKg: 10, pricePerKg: 100, harvestDate: new Date().toISOString() } })).status, 403);
  assert.equal((await http("PATCH", "/marketplace/listings/000000000000000000000001/confirm-order", { token: F1.token, body: { buyerId: B.id } })).status, 403);
  assert.equal((await http("POST", "/crowdfunding/campaigns/000000000000000000000001/pledge", { token: B.token, body: { investor: F1.id, amountLkr: 5000 } })).status, 403);
  assert.equal((await http("POST", "/disease/scan", { token: F1.token, body: { farmer: F2.id } })).status, 403);
  ok("claiming to be another person (in the body or the query) is refused (403) on reminders, timelines, chat, listings, orders, pledges and scans");
  assert.notEqual((await http("GET", `/reminders?farmer=${F1.id}`, { token: F1.token })).status, 403); assert.notEqual((await http("GET", `/timelines/mine?farmerId=${F1.id}`, { token: F1.token })).status, 403); ok("acting as yourself still works");

  // someone else's records
  const L = await Listing.create({ farmer: F2.id, cropType: "Tomato", quantityKg: 50, originalPricePerKg: 100, currentPricePerKg: 100, harvestDate: new Date(), qualityGrade: "A" });
  assert.equal((await http("PATCH", `/marketplace/listings/${L._id}`, { token: F1.token, body: { farmerId: F1.id, pricePerKg: 1 } })).status, 403); assert.equal((await http("PATCH", `/marketplace/listings/${L._id}`, { token: F2.token, body: { farmerId: F2.id, pricePerKg: 90 } })).status, 200); assert.equal((await Listing.findById(L._id)).currentPricePerKg, 90); ok("another farmer cannot change your listing's price (403); you can (200)");
  const R = await Reminder.create({ farmer: F2.id, timelineRef: "t1", cropType: "Tomato", type: "weather_action", title: "x", message: "y", dedupeKey: "sec-" + Date.now() });
  assert.equal((await http("PATCH", `/reminders/${R._id}`, { token: F1.token, body: { status: "dismissed" } })).status, 403); assert.equal((await http("PATCH", `/reminders/${R._id}`, { token: F2.token, body: { status: "dismissed" } })).status, 200); ok("nobody else can dismiss your reminders");
  const lorry = await Lorry.create({ driver: D.id, vehicleRegistrationNo: "SEC-1", totalCapacityKg: 1000, remainingCapacityKg: 1000, currentLocation: { type: "Point", coordinates: [80, 7] }, destinationHub: "Kandy", cargoBookings: [{ farmer: F1.id, weightKg: 10, status: "requested" }] });
  const bid = String((await Lorry.findById(lorry._id)).cargoBookings[0]._id);
  assert.equal((await http("PATCH", `/logistics/lorries/${lorry._id}/location`, { token: F1.token, body: { latitude: 7.1, longitude: 80.1 } })).status, 403); assert.equal((await http("PATCH", `/logistics/lorries/${lorry._id}/location`, { token: D.token, body: { latitude: 7.1, longitude: 80.1 } })).status, 200); assert.equal((await http("PATCH", `/logistics/lorries/${lorry._id}/toggle-tracking`, { token: F1.token, body: { isTrackingActive: true } })).status, 403);
  assert.equal((await http("PATCH", `/logistics/lorries/${lorry._id}/cargo/${bid}`, { token: F2.token, body: { status: "confirmed" } })).status, 403); assert.notEqual((await http("PATCH", `/logistics/lorries/${lorry._id}/cargo/${bid}`, { token: F1.token, body: { status: "cancelled" } })).status, 403); ok("only a lorry's own driver can move it or switch tracking; a booking can be changed only by that driver or the farmer who made it");
  assert.equal((await http("POST", "/logistics/lorries", { token: F.token, body: { driver: F.id } })).status, 403); assert.equal((await http("POST", "/crowdfunding/campaigns", { token: B.token, body: { farmer: B.id } })).status, 403); ok("only drivers can register lorries and only farmers can start campaigns");
  await Listing.deleteOne({ _id: L._id }); await Reminder.deleteOne({ _id: R._id }); await Lorry.deleteOne({ _id: lorry._id }); await mongoose.disconnect();
  console.log(`\nALL ${passed} SECURITY TESTS PASSED`);
})().catch(async (e) => { console.error("\nFAILED:", e.message, (e.stack || "").split("\n")[1]); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
