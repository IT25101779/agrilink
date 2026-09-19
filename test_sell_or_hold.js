const assert = require("assert");
const { adviseListing, sortByUrgency } = require("./utils/sellOrHold");
const { interpolatePrice } = require("./utils/priceForecast");
const D = 864e5;
const now = new Date("2026-09-19T06:00:00Z");
const day = (n) => new Date(now.getTime() + n * D);

// Flat forecast at 200/kg (weekly points, 13 of them), optionally with a rise
function forecast({ flat = 200, rises = null, confidence = "medium" } = {}) {
  const points = [];
  for (let w = 0; w <= 12; w++) {
    let price = flat;
    if (rises) price = rises(w, flat);
    points.push({ date: day(w * 7).toISOString(), weekOffset: w, pricePerKg: price, event: rises && rises(w, flat) > flat ? "Test Festival" : null });
  }
  return { points, confidence };
}
const L = (o) => ({ _id: "L1", cropType: "Tomato", currentPricePerKg: 200, quantityKg: 100, tier: "primary", harvestDate: day(-0.2), ...o });
let n = 0; const ok = (name) => console.log(`  ok ${++n}. ${name}`);

// interpolation
const pts = [{ date: day(0).toISOString(), pricePerKg: 100 }, { date: day(7).toISOString(), pricePerKg: 170 }];
assert.equal(interpolatePrice(pts, day(3.5)), 135); assert.equal(interpolatePrice(pts, day(-5)), 100); assert.equal(interpolatePrice(pts, day(99)), 170); ok("interpolation midpoint / clamps");

let a;
// 1 expired
a = adviseListing({ listing: L({ harvestDate: day(-9) }), forecast: forecast(), now });
assert.equal(a.action, "sell_now"); assert.equal(a.urgency, "high"); assert.match(a.headline, /ended/); ok("expired -> sell_now (high)");
// 2 urgent freshness (5 days old tomato = 29% left)
a = adviseListing({ listing: L({ harvestDate: day(-5) }), forecast: forecast(), now });
assert.equal(a.action, "sell_now"); assert.match(a.headline, /2 days/); ok("nearly-expired -> sell_now with day count");
a = adviseListing({ listing: L({ harvestDate: day(-6) }), forecast: forecast(), now });
assert.match(a.headline, /1 day of/); ok("singular '1 day'");
// 3 overpriced / underpriced
a = adviseListing({ listing: L({ currentPricePerKg: 250 }), forecast: forecast(), now });
assert.equal(a.action, "reprice_down"); assert.match(a.headline, /25%/); ok("overpriced -> reprice_down (25%)");
a = adviseListing({ listing: L({ currentPricePerKg: 160 }), forecast: forecast(), now });
assert.equal(a.action, "reprice_up"); assert.match(a.headline, /20%/); ok("underpriced -> reprice_up (20%)");
// 3b flash sale exempt
a = adviseListing({ listing: L({ currentPricePerKg: 150, tier: "secondary" }), forecast: forecast(), now });
assert.equal(a.action, "steady"); ok("flash-sale (secondary) discount is NOT flagged as underpriced");
// 3c flash sale never told to HOLD even when prices are climbing
a = adviseListing({ listing: L({ currentPricePerKg: 184, tier: "secondary", cropType: "Carrot" }), forecast: forecast(), trend: { percent: 9, samples: 4 }, saturationLevel: "low", now });
assert.equal(a.action, "steady"); assert.match(a.headline, /Flash sale/); ok("flash-sale listing is not told to hold when prices climb");
a = adviseListing({ listing: L({ currentPricePerKg: 184, tier: "secondary", harvestDate: day(-9) }), forecast: forecast(), now });
assert.equal(a.action, "sell_now"); ok("...but an EXPIRED flash-sale listing still gets the urgent sell-now warning");
// boundaries: 14% over is fine, 15% over flagged
a = adviseListing({ listing: L({ currentPricePerKg: 228 }), forecast: forecast(), now }); assert.equal(a.action, "steady");
a = adviseListing({ listing: L({ currentPricePerKg: 230 }), forecast: forecast(), now }); assert.equal(a.action, "reprice_down"); ok("overpriced boundary 14% steady / 15% flagged");
// 4 calendar hold: pumpkin lasts 60 days; forecast jumps 12% from week 1
const rise = forecast({ rises: (w, f) => (w >= 1 ? f * 1.12 : f) });
a = adviseListing({ listing: L({ cropType: "Pumpkin" }), forecast: rise, now });
assert.equal(a.action, "hold"); assert.ok(a.holdUntil); assert.match(a.reasons[0], /Test Festival/); ok(`calendar rise -> hold until ${a.holdUntil.slice(0, 10)}: "${a.headline}"`);
// calendar rise but tomato is perishable: freshness discount eats the gain -> should NOT recommend a long hold
a = adviseListing({ listing: L({ cropType: "Tomato" }), forecast: forecast({ rises: (w, f) => (w >= 1 ? f * 1.06 : f) }), now });
assert.notEqual(a.action === "hold" && /6 day/.test(a.headline), true); ok(`perishable tomato: small rise doesn't beat freshness decay (${a.action})`);
// 5 trend hold
a = adviseListing({ listing: L({ cropType: "Beans (Bush)" }), forecast: forecast(), trend: { percent: 8.3, samples: 4 }, saturationLevel: "low", now });
assert.equal(a.action, "hold"); assert.match(a.headline, /\+8.3%.*3 days/); ok(`trend up -> hold 3 days: "${a.headline}"`);
// 6 trend hold blocked by high supply -> sell_now with BOTH-signal explanation
a = adviseListing({ listing: L(), forecast: forecast(), trend: { percent: 11.6, samples: 5 }, saturationLevel: "high", now });
assert.equal(a.action, "sell_now"); assert.ok(a.reasons.some((r) => /Many farmers/.test(r))); ok("prices up BUT high local supply -> sell_now (Oversupply Guard synergy)");
// 7 trend down
a = adviseListing({ listing: L(), forecast: forecast(), trend: { percent: -9, samples: 3 }, saturationLevel: "low", now });
assert.equal(a.action, "sell_now"); assert.ok(a.reasons.some((r) => /lower than the month before/.test(r))); ok("falling trend -> sell_now");
// 8 steady, no trend
a = adviseListing({ listing: L(), forecast: forecast(), now }); assert.equal(a.action, "steady"); ok("in-line price, no signals -> steady");
// 9 not yet harvested: hold clock starts at harvest
a = adviseListing({ listing: L({ harvestDate: day(3), cropType: "Beans (Bush)" }), forecast: forecast(), trend: { percent: 9, samples: 3 }, saturationLevel: "low", now });
assert.equal(a.action, "hold"); assert.ok(new Date(a.holdUntil) > day(3)); ok("not-yet-harvested: holdUntil counted from harvest date");
// 10 short-life crop can't be held on trend alone (3 days left -> <4)
a = adviseListing({ listing: L({ cropType: "Okra (Bandakka)", harvestDate: day(-1) }), forecast: forecast(), trend: { percent: 20, samples: 5 }, saturationLevel: "low", now });
assert.notEqual(a.action, "hold"); ok(`very perishable okra never told to hold on trend (${a.action})`);
// 11 shape + sorting
a = adviseListing({ listing: L(), forecast: forecast(), now });
["listingId", "cropType", "action", "urgency", "headline", "reasons", "askingPricePerKg", "fairPricePerKg", "freshnessLabel", "daysLeft", "confidence", "holdUntil"].forEach((k) => assert.ok(k in a, "missing " + k));
const sorted = sortByUrgency([{ urgency: "none" }, { urgency: "high" }, { urgency: "low" }, { urgency: "medium" }]).map((x) => x.urgency);
assert.deepEqual(sorted, ["high", "medium", "low", "none"]); ok("response shape complete; urgent advice sorts first");
console.log(`\nALL ${n} PURE-LOGIC TESTS PASSED`);
