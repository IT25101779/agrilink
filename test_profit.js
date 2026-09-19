const assert = require("assert");
const { planProfit } = require("./utils/cropEconomics");
const D = 864e5; const now = new Date("2026-09-19T06:00:00Z");
const fc = ({ flat = 170, source = "sold_history", confidence = "medium", weeks = 16, rise = null } = {}) => ({
  confidence, baselineSource: source,
  points: Array.from({ length: weeks + 1 }, (_, w) => ({ date: new Date(now.getTime() + w * 7 * D).toISOString(), weekOffset: w, pricePerKg: rise ? rise(w, flat) : flat, event: null })),
});
let n = 0; const ok = (m) => console.log(`  ok ${++n}. ${m}`);
let p;
p = planProfit({ cropType: "Mango", acres: 1, forecast: fc(), now }); assert.equal(p.supported, false); assert.match(p.message, /annual crops/); ok("perennial crop (Mango) is refused with an explanation");
p = planProfit({ cropType: "tomato ", acres: 1, forecast: fc(), now }); assert.equal(p.supported, true); assert.equal(p.cropType, "Tomato"); ok("crop lookup ignores case/spaces");
// Tomato 1 acre @170: 7000*0.88=6160kg -> 1,047,200 revenue, cost 450,000
assert.equal(p.scenarios.expected.sellableKg, 6160); assert.equal(p.scenarios.expected.revenueLkr, 1047200); assert.equal(p.scenarios.expected.profitLkr, 597200); assert.equal(p.scenarios.expected.roiPercent, 132.7); assert.equal(p.verdict, "good"); ok("Tomato 1 acre @ LKR170: revenue 1,047,200, profit 597,200, ROI 132.7% -> good");
assert.ok(p.scenarios.low.profitLkr < p.scenarios.expected.profitLkr && p.scenarios.expected.profitLkr < p.scenarios.high.profitLkr); ok("low < expected < high profit");
assert.equal(p.breakEvenPricePerKg, 73.1); ok("break-even price = cost / sellable kg = LKR 73.1/kg");
// acres scaling
const p2 = planProfit({ cropType: "Tomato", acres: 2, forecast: fc(), now }); assert.equal(p2.scenarios.expected.profitLkr, p.scenarios.expected.profitLkr * 2); assert.equal(p2.breakEvenPricePerKg, p.breakEvenPricePerKg); ok("2 acres doubles profit; break-even price unchanged");
// overrides
const p3 = planProfit({ cropType: "Tomato", acres: 1, overrides: { yieldKgPerAcre: 4000, costPerAcre: 500000, pricePerKg: 150 }, forecast: fc(), now });
assert.equal(p3.assumptions.yieldIsEdited, true); assert.equal(p3.assumptions.costIsEdited, true); assert.equal(p3.assumptions.priceSource, "farmer"); assert.equal(p3.scenarios.expected.revenueLkr, Math.round(4000 * 0.88 * 150)); ok("farmer's own yield / cost / price override every default");
// needs price
p = planProfit({ cropType: "Carrot", acres: 1, forecast: fc({ source: "no_data_flat_default", confidence: "low" }), now }); assert.equal(p.verdict, "needs_price"); assert.equal(p.scenarios, null); assert.ok(p.breakEvenPricePerKg > 0); assert.match(p.riskNotes[0], /break even/); ok(`no price data -> asks for a price, still gives break-even (LKR ${p.breakEvenPricePerKg}/kg)`);
p = planProfit({ cropType: "Carrot", acres: 1, overrides: { pricePerKg: 220 }, forecast: fc({ source: "no_data_flat_default", confidence: "low" }), now }); assert.equal(p.verdict !== "needs_price", true); assert.equal(p.assumptions.priceSource, "farmer"); ok("...and works once the farmer supplies a price");
// loss case
p = planProfit({ cropType: "Paddy (Rice)", acres: 1, forecast: fc({ flat: 60 }), now }); assert.equal(p.verdict, "loss"); assert.ok(p.riskNotes.some((x) => /below your break-even/.test(x))); assert.ok(p.riskNotes.some((x) => /lose about/.test(x))); ok("a losing plan is called a loss, with break-even and downside warnings");
// crowded
const a = planProfit({ cropType: "Tomato", acres: 1, forecast: fc(), saturationLevel: "low", now }); const b = planProfit({ cropType: "Tomato", acres: 1, forecast: fc(), saturationLevel: "high", now });
assert.ok(b.scenarios.low.profitLkr < a.scenarios.low.profitLkr); assert.equal(b.scenarios.expected.profitLkr, a.scenarios.expected.profitLkr); assert.ok(b.riskNotes.some((x) => /Many farmers/.test(x))); ok("crowded market only worsens the LOW case (expected case not silently changed) and warns");
// harvest-date pricing: price rises after week 10 -> tomato (75d = week ~10.7) should use the higher price
const rising = planProfit({ cropType: "Tomato", acres: 1, forecast: fc({ rise: (w, f) => (w >= 11 ? f * 1.2 : f) }), now });
assert.ok(rising.scenarios.expected.pricePerKg > 170); ok(`uses the price at HARVEST time, not today's (LKR ${rising.scenarios.expected.pricePerKg})`);
// long crop beyond forecast horizon
p = planProfit({ cropType: "Ash Plantain", acres: 1, forecast: fc({ weeks: 16 }), now }); assert.ok(p.riskNotes.some((x) => /only reaches 16 weeks/.test(x))); assert.ok(p.riskNotes.some((x) => /months/.test(x))); ok("crop longer than the forecast horizon is flagged, and long cycle noted");
// shape
["supported", "cropType", "acres", "harvestDate", "assumptions", "breakEvenPricePerKg", "verdict", "scenarios", "riskNotes", "disclaimer"].forEach((k) => assert.ok(k in planProfit({ cropType: "Beans (Bush)", acres: 1, forecast: fc(), now }))); ok("response shape complete");
console.log(`\nALL ${n} PROFIT PLANNER TESTS PASSED`);
