const { interpolatePrice } = require("./priceForecast");

/**
 * PROFIT PLANNER
 *
 * Answers the question every farmer asks before planting: "will this crop
 * make money?". For one crop and a plot size it estimates cost, harvest and
 * revenue, and shows a LOW / EXPECTED / HIGH range instead of one number.
 *
 * IMPORTANT — HONESTY:
 *  - The yield and cost figures below are TYPICAL PLANNING ESTIMATES for
 *    Sri Lankan smallholders (per acre, one crop cycle), rounded and kept
 *    deliberately cautious. Real farms vary a lot. The app lets the farmer
 *    change every assumption, and says these are estimates.
 *  - They should be confirmed with the Department of Agriculture / an
 *    agriculture officer before being presented as facts.
 *  - Only ANNUAL crops are supported. Tree and plantation crops (mango,
 *    coconut, tea...) take years to pay back, so a one-cycle profit figure
 *    would be misleading.
 *
 * Crop names match the mobile app's crop catalogue EXACTLY.
 */

const ECONOMICS = {
  // ---- Vegetables ----
  "Tomato": { yieldKgPerAcre: 7000, costLkrPerAcre: 450000, growthDays: 75, lossPercent: 12 },
  "Chili": { yieldKgPerAcre: 2400, costLkrPerAcre: 380000, growthDays: 90, lossPercent: 10 },
  "Okra (Bandakka)": { yieldKgPerAcre: 3500, costLkrPerAcre: 260000, growthDays: 60, lossPercent: 12 },
  "Brinjal (Eggplant)": { yieldKgPerAcre: 6000, costLkrPerAcre: 330000, growthDays: 80, lossPercent: 10 },
  "Cabbage": { yieldKgPerAcre: 9000, costLkrPerAcre: 420000, growthDays: 70, lossPercent: 10 },
  "Carrot": { yieldKgPerAcre: 8000, costLkrPerAcre: 480000, growthDays: 85, lossPercent: 8 },
  "Beans (Bush)": { yieldKgPerAcre: 3000, costLkrPerAcre: 340000, growthDays: 55, lossPercent: 12 },
  "Cucumber": { yieldKgPerAcre: 6000, costLkrPerAcre: 300000, growthDays: 55, lossPercent: 12 },
  "Pumpkin": { yieldKgPerAcre: 8000, costLkrPerAcre: 260000, growthDays: 100, lossPercent: 5 },
  "Bitter Gourd": { yieldKgPerAcre: 4000, costLkrPerAcre: 320000, growthDays: 65, lossPercent: 12 },
  "Snake Gourd": { yieldKgPerAcre: 5000, costLkrPerAcre: 300000, growthDays: 70, lossPercent: 12 },
  "Ash Plantain": { yieldKgPerAcre: 8000, costLkrPerAcre: 350000, growthDays: 270, lossPercent: 8 },
  "Beetroot": { yieldKgPerAcre: 7000, costLkrPerAcre: 400000, growthDays: 70, lossPercent: 8 },
  "Leeks": { yieldKgPerAcre: 6500, costLkrPerAcre: 430000, growthDays: 90, lossPercent: 8 },
  "Knol Khol": { yieldKgPerAcre: 6000, costLkrPerAcre: 350000, growthDays: 60, lossPercent: 8 },
  "Radish": { yieldKgPerAcre: 5000, costLkrPerAcre: 220000, growthDays: 40, lossPercent: 8 },
  "Winged Bean": { yieldKgPerAcre: 2500, costLkrPerAcre: 300000, growthDays: 80, lossPercent: 12 },
  "Onion (Big/Red)": { yieldKgPerAcre: 8000, costLkrPerAcre: 520000, growthDays: 100, lossPercent: 10 },

  // ---- Fruit (annual) ----
  "Watermelon": { yieldKgPerAcre: 10000, costLkrPerAcre: 380000, growthDays: 85, lossPercent: 8 },

  // ---- Rice & grains ----
  "Paddy (Rice)": { yieldKgPerAcre: 1900, costLkrPerAcre: 170000, growthDays: 105, lossPercent: 5 },
  "Maize (Corn)": { yieldKgPerAcre: 2000, costLkrPerAcre: 150000, growthDays: 100, lossPercent: 5 },
  "Kurakkan (Finger Millet)": { yieldKgPerAcre: 800, costLkrPerAcre: 110000, growthDays: 90, lossPercent: 5 },
  "Sorghum": { yieldKgPerAcre: 1000, costLkrPerAcre: 120000, growthDays: 100, lossPercent: 5 },

  // ---- Legumes ----
  "Green Gram (Mung Bean)": { yieldKgPerAcre: 500, costLkrPerAcre: 100000, growthDays: 65, lossPercent: 5 },
  "Cowpea": { yieldKgPerAcre: 600, costLkrPerAcre: 100000, growthDays: 70, lossPercent: 5 },
  "Soybean": { yieldKgPerAcre: 900, costLkrPerAcre: 120000, growthDays: 95, lossPercent: 5 },
  "Groundnut (Peanut)": { yieldKgPerAcre: 900, costLkrPerAcre: 190000, growthDays: 100, lossPercent: 5 },
  "Black Gram (Ulundu)": { yieldKgPerAcre: 500, costLkrPerAcre: 100000, growthDays: 75, lossPercent: 5 },
};

const LOOKUP = Object.fromEntries(Object.entries(ECONOMICS).map(([name, v]) => [name.toLowerCase(), { name, ...v }]));

// Scenario multipliers: a poor season, the expected case, and a good season.
const SCENARIOS = {
  low: { yield: 0.75, price: 0.85 },
  expected: { yield: 1, price: 1 },
  high: { yield: 1.15, price: 1.15 },
};
const CROWDED_MARKET_EXTRA_PRICE_DROP = 0.9; // applied to the LOW case only

function round(n) {
  return Math.round(n);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function findEconomics(cropType) {
  return LOOKUP[String(cropType || "").trim().toLowerCase()] || null;
}

function scenarioResult({ acres, yieldKgPerAcre, lossPercent, costPerAcre, pricePerKg }) {
  const sellableKg = acres * yieldKgPerAcre * (1 - lossPercent / 100);
  const revenue = sellableKg * pricePerKg;
  const cost = acres * costPerAcre;
  const profit = revenue - cost;
  return {
    sellableKg: round(sellableKg),
    pricePerKg: round1(pricePerKg),
    revenueLkr: round(revenue),
    costLkr: round(cost),
    profitLkr: round(profit),
    roiPercent: cost > 0 ? round1((profit / cost) * 100) : 0,
  };
}

/**
 * Pure calculation (no database). The controller supplies the price forecast
 * and the local supply level; the farmer may override any assumption.
 *
 * @param {object} args
 * @param {string} args.cropType
 * @param {number} args.acres
 * @param {object} [args.overrides] { yieldKgPerAcre, costPerAcre, pricePerKg }
 * @param {object|null} args.forecast  result of buildForecast() (16 weeks recommended)
 * @param {string} [args.saturationLevel] "low" | "medium" | "high" | "unknown"
 * @param {Date} [args.now]
 */
function planProfit({ cropType, acres, overrides = {}, forecast, saturationLevel = "unknown", now = new Date() }) {
  const base = findEconomics(cropType);
  if (!base) {
    return {
      supported: false,
      cropType,
      reason: "perennial_or_unlisted",
      message: "A one-cycle profit estimate is only available for annual crops. Tree and plantation crops take several years to pay back.",
    };
  }

  const yieldKgPerAcre = overrides.yieldKgPerAcre > 0 ? overrides.yieldKgPerAcre : base.yieldKgPerAcre;
  const costPerAcre = overrides.costPerAcre > 0 ? overrides.costPerAcre : base.costLkrPerAcre;
  const lossPercent = base.lossPercent;
  const harvestDate = new Date(now.getTime() + base.growthDays * 24 * 60 * 60 * 1000);

  // ---- Which price do we use at harvest time? ----
  let pricePerKg = null;
  let priceSource = "none";
  let priceConfidence = forecast ? forecast.confidence : "low";
  const notes = [];

  if (overrides.pricePerKg > 0) {
    pricePerKg = overrides.pricePerKg;
    priceSource = "farmer";
  } else if (forecast && forecast.baselineSource !== "no_data_flat_default") {
    pricePerKg = interpolatePrice(forecast.points, harvestDate);
    priceSource = "forecast";
    const horizonDays = forecast.points[forecast.points.length - 1].weekOffset * 7;
    if (base.growthDays > horizonDays) {
      notes.push(`The price outlook only reaches ${Math.round(horizonDays / 7)} weeks ahead. This crop takes ${base.growthDays} days, so the harvest-time price is assumed to stay close to the last forecast week.`);
    }
  }

  const breakEvenPricePerKg = round1((acres * costPerAcre) / (acres * yieldKgPerAcre * (1 - lossPercent / 100)));

  const assumptions = {
    yieldKgPerAcre,
    costPerAcre,
    lossPercent,
    growthDays: base.growthDays,
    expectedPricePerKg: pricePerKg === null ? null : round1(pricePerKg),
    priceSource,
    defaults: { yieldKgPerAcre: base.yieldKgPerAcre, costPerAcre: base.costLkrPerAcre },
    yieldIsEdited: yieldKgPerAcre !== base.yieldKgPerAcre,
    costIsEdited: costPerAcre !== base.costLkrPerAcre,
  };

  const common = {
    supported: true,
    cropType: base.name,
    acres,
    harvestDate: harvestDate.toISOString(),
    assumptions,
    breakEvenPricePerKg,
    priceConfidence,
    disclaimer:
      "Planning estimate only. Typical yield and cost figures vary by farm, season, seed and inputs. Change any figure above to match your own.",
  };

  // ---- No trustworthy price yet: give the break-even and ask for a price ----
  if (pricePerKg === null) {
    return {
      ...common,
      verdict: "needs_price",
      scenarios: null,
      riskNotes: [
        `Not enough market price data for ${base.name} yet. To break even you need to sell at about LKR ${breakEvenPricePerKg}/kg. Enter the price you expect to get and the plan will be calculated.`,
      ],
    };
  }

  const crowded = saturationLevel === "high";
  const scenarios = {};
  for (const [key, mult] of Object.entries(SCENARIOS)) {
    const priceFactor = key === "low" && crowded ? mult.price * CROWDED_MARKET_EXTRA_PRICE_DROP : mult.price;
    scenarios[key] = scenarioResult({
      acres,
      yieldKgPerAcre: yieldKgPerAcre * mult.yield,
      lossPercent,
      costPerAcre,
      pricePerKg: pricePerKg * priceFactor,
    });
  }

  // ---- Verdict + risk notes ----
  const expected = scenarios.expected;
  let verdict = "loss";
  if (expected.roiPercent >= 40) verdict = "good";
  else if (expected.roiPercent >= 10) verdict = "fair";
  else if (expected.roiPercent >= 0) verdict = "marginal";

  const riskNotes = [...notes];
  if (scenarios.low.profitLkr < 0) {
    riskNotes.push(`In a poor season (less harvest, lower price) you could lose about LKR ${Math.abs(scenarios.low.profitLkr).toLocaleString("en-US")}.`);
  }
  if (crowded) {
    riskNotes.push("Many farmers near you are growing this crop, so prices could be lower than the forecast when everyone harvests. The poor-season case already allows for this.");
  }
  if (pricePerKg < breakEvenPricePerKg) {
    riskNotes.push(`The expected price (LKR ${round1(pricePerKg)}/kg) is below your break-even price (LKR ${breakEvenPricePerKg}/kg).`);
  }
  if (priceSource === "forecast" && priceConfidence === "low") {
    riskNotes.push("The price forecast is based on little sales data, so treat the profit figure as rough.");
  }
  if (base.growthDays > 120) {
    riskNotes.push(`This crop takes about ${Math.round(base.growthDays / 30)} months, so your money is tied up for longer.`);
  }

  return { ...common, verdict, scenarios, riskNotes };
}

module.exports = { ECONOMICS, planProfit, findEconomics, SCENARIOS };
