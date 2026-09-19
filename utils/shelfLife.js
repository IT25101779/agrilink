/**
 * FRESHNESS CLOCK
 *
 * Every crop has a rough "sell-by window" — how many days after harvest it
 * stays good enough to sell at full quality. This file turns a listing's
 * harvest date into:
 *   - how many days of freshness are left,
 *   - a freshness label (fresh / aging / urgent / expired),
 *   - a live price factor: the price stays FULL for the first part of the
 *     window, then falls smoothly to 60% at the end of it.
 *
 * The price is worked out at the moment someone looks at it (never stored),
 * so it is always current and there is nothing to keep in sync.
 *
 * IMPORTANT: the day counts below are reasonable ESTIMATES for Sri Lankan
 * ambient conditions (no cold storage), not lab-measured values. They are
 * easy to tune here in one place — ideally confirm them with an agriculture
 * officer before any real launch.
 *
 * Crop names match the mobile app's crop catalogue EXACTLY.
 */

const DEFAULT_SHELF_LIFE_DAYS = 7;

const SHELF_LIFE_DAYS = {
  // ---- Vegetables ----
  "Tomato": 7,
  "Chili": 7,
  "Okra (Bandakka)": 4,
  "Brinjal (Eggplant)": 6,
  "Cabbage": 14,
  "Carrot": 14,
  "Beans (Bush)": 5,
  "Cucumber": 7,
  "Pumpkin": 60,
  "Bitter Gourd": 5,
  "Snake Gourd": 5,
  "Ash Plantain": 10,
  "Beetroot": 14,
  "Leeks": 10,
  "Knol Khol": 10,
  "Radish": 7,
  "Winged Bean": 4,
  "Onion (Big/Red)": 60,

  // ---- Fruits ----
  "Banana": 6,
  "Papaya": 5,
  "Pineapple": 8,
  "Mango": 6,
  "Watermelon": 14,
  "Passion Fruit": 10,
  "Guava": 5,
  "Rambutan": 5,
  "Avocado": 6,
  "Wood Apple": 14,
  "Lime": 14,

  // ---- Rice & grains (dried, stored) ----
  "Paddy (Rice)": 180,
  "Maize (Corn)": 30,
  "Kurakkan (Finger Millet)": 180,
  "Sorghum": 180,

  // ---- Spices ----
  "Black Pepper": 180,
  "Cinnamon": 365,
  "Cardamom": 180,
  "Cloves": 365,
  "Nutmeg": 365,
  "Ginger": 30,
  "Turmeric": 30,

  // ---- Legumes (dried) ----
  "Green Gram (Mung Bean)": 180,
  "Cowpea": 180,
  "Soybean": 180,
  "Groundnut (Peanut)": 120,
  "Black Gram (Ulundu)": 180,

  // ---- Plantation crops ----
  "Tea": 2, // green leaf must be processed almost immediately
  "Rubber": 30,
  "Coconut": 60,
  "Coffee": 30,
  "Arecanut": 90,
  "Cashew": 90,
};

// Lower-case lookup so "tomato", "TOMATO " and "Tomato" all resolve.
const LOOKUP = Object.fromEntries(Object.entries(SHELF_LIFE_DAYS).map(([name, days]) => [name.toLowerCase(), days]));

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The price holds at 100% until this much of the shelf life has been used...
const FULL_PRICE_UNTIL_FRACTION_USED = 0.3;
// ...then falls linearly to this fraction of the price at the end of the window.
const MIN_PRICE_FACTOR = 0.6;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function getShelfLifeDays(cropType) {
  if (!cropType) return DEFAULT_SHELF_LIFE_DAYS;
  const exact = LOOKUP[String(cropType).trim().toLowerCase()];
  if (exact) return exact;

  // Free-typed names from older listings ("tomatoes", "Beans") — match on
  // the first word so they still get a sensible window instead of the default.
  const firstWord = String(cropType).trim().toLowerCase().split(/[\s(]/)[0];
  if (firstWord.length >= 3) {
    for (const [name, days] of Object.entries(LOOKUP)) {
      if (name.startsWith(firstWord) || firstWord.startsWith(name.split(/[\s(]/)[0])) return days;
    }
  }
  return DEFAULT_SHELF_LIFE_DAYS;
}

/**
 * Price multiplier (0.6 - 1.0) for a given fraction of the shelf life that
 * has already been used (0 = just harvested, 1 = end of the window).
 */
function priceFactorForUsedFraction(usedFraction) {
  if (usedFraction <= FULL_PRICE_UNTIL_FRACTION_USED) return 1;
  if (usedFraction >= 1) return MIN_PRICE_FACTOR;
  const declineProgress = (usedFraction - FULL_PRICE_UNTIL_FRACTION_USED) / (1 - FULL_PRICE_UNTIL_FRACTION_USED);
  return round2(1 - (1 - MIN_PRICE_FACTOR) * declineProgress);
}

/**
 * Works out the freshness picture of a listing at a moment in time.
 * `listing` needs: cropType, harvestDate, currentPricePerKg.
 */
function computeFreshness(listing, now = new Date()) {
  const shelfLifeDays = getShelfLifeDays(listing.cropType);
  const harvest = new Date(listing.harvestDate);
  const currentPrice = Number(listing.currentPricePerKg) || 0;
  const ageDays = (now.getTime() - harvest.getTime()) / MS_PER_DAY;

  // Not harvested yet (farmer listed ahead of harvest): clock hasn't started.
  if (ageDays < 0) {
    return {
      state: "not_harvested",
      label: "not_harvested",
      shelfLifeDays,
      daysUntilHarvest: Math.ceil(-ageDays),
      daysLeft: shelfLifeDays,
      percentRemaining: 100,
      priceFactor: 1,
      effectivePricePerKg: round2(currentPrice),
      expired: false,
    };
  }

  const usedFraction = Math.min(Math.max(ageDays / shelfLifeDays, 0), 1);
  const percentRemaining = Math.round((1 - usedFraction) * 100);
  const priceFactor = priceFactorForUsedFraction(usedFraction);
  const expired = ageDays >= shelfLifeDays;
  const daysLeft = Math.max(0, Math.ceil(shelfLifeDays - ageDays));

  let label = "fresh";
  if (expired) label = "expired";
  else if (percentRemaining < 30) label = "urgent";
  else if (percentRemaining < 70) label = "aging";

  return {
    state: "harvested",
    label,
    shelfLifeDays,
    daysUntilHarvest: 0,
    daysLeft,
    percentRemaining,
    priceFactor,
    effectivePricePerKg: round2(currentPrice * priceFactor),
    expired,
  };
}

module.exports = {
  SHELF_LIFE_DAYS,
  DEFAULT_SHELF_LIFE_DAYS,
  getShelfLifeDays,
  priceFactorForUsedFraction,
  computeFreshness,
};
