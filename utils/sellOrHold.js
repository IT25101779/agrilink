const { computeFreshness } = require("./shelfLife");
const { interpolatePrice } = require("./priceForecast");

/**
 * SELL-OR-HOLD ADVISOR
 *
 * A pure function (no database access) so every rule can be tested in
 * isolation. It looks at ONE listing and answers: "should the farmer sell
 * now, hold a few days, or change the asking price?"
 *
 * Signals used (all explained back to the farmer in `reasons`):
 *   1. Freshness   - expired / nearly expired produce should be sold NOW.
 *   2. Fair price  - the app's own market estimate vs the asking price.
 *   3. Calendar    - a festival price rise inside the hold window.
 *   4. Trend       - recent real sales prices rising or falling.
 *   5. Supply      - many farmers harvesting the same crop nearby.
 *
 * Actions: sell_now | hold | reprice_up | reprice_down | steady
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const OVERPRICED_RATIO = 1.15; // asking 15%+ above the fair price
const UNDERPRICED_RATIO = 0.88; // asking 12%+ below the fair price
const CALENDAR_HOLD_GAIN_PERCENT = 5; // festival uplift worth waiting for
const TREND_UP_PERCENT = 6;
const TREND_DOWN_PERCENT = -6;
const URGENT_PERCENT_REMAINING = 30;
const MAX_HOLD_DAYS = 14;
const MAX_TREND_HOLD_DAYS = 3; // trend alone never justifies a long wait

function round1(n) {
  return Math.round(n * 10) / 10;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {object} args
 * @param {object} args.listing   { _id, cropType, currentPricePerKg, harvestDate, quantityKg }
 * @param {object} args.forecast  result of buildForecast()
 * @param {object|null} args.trend { percent, samples }  recent sold-price trend, or null
 * @param {string} args.saturationLevel "low" | "medium" | "high" | "unknown"
 * @param {Date} [args.now]
 */
function adviseListing({ listing, forecast, trend = null, saturationLevel = "unknown", now = new Date() }) {
  const asking = Number(listing.currentPricePerKg);
  const fair = forecast.points[0].pricePerKg;
  const freshNow = computeFreshness(listing, now);
  const reasons = [];

  const base = {
    listingId: String(listing._id),
    cropType: listing.cropType,
    askingPricePerKg: round2(asking),
    fairPricePerKg: round2(fair),
    freshnessLabel: freshNow.label,
    daysLeft: freshNow.daysLeft,
    confidence: forecast.confidence,
    holdUntil: null,
  };

  const gapPercent = fair > 0 ? round1(((asking - fair) / fair) * 100) : 0;

  // ---- 1. Freshness comes first: produce that is spoiling cannot wait ----
  if (freshNow.expired) {
    return {
      ...base,
      action: "sell_now",
      urgency: "high",
      headline: "Freshness window has ended — sell today",
      reasons: [
        "This produce is past its recommended sell-by window, so the price is already at its lowest level.",
        "Try the Secondary Market: factories, restaurants and compost hubs still buy produce at this stage.",
      ],
    };
  }
  if (freshNow.state === "harvested" && freshNow.percentRemaining < URGENT_PERCENT_REMAINING) {
    return {
      ...base,
      action: "sell_now",
      urgency: "high",
      headline: `Only ${freshNow.daysLeft} day${freshNow.daysLeft === 1 ? "" : "s"} of freshness left — sell now`,
      reasons: [
        `Freshness is at ${freshNow.percentRemaining}%. The price drops a little every day from here.`,
        "Selling to a nearby buyer today protects the value of the harvest.",
      ],
    };
  }

  // ---- 2. Is the asking price in line with the market? ----
  // Flash-sale (secondary tier) listings are DELIBERATELY discounted after a
  // buyer rejection, so telling the farmer to "raise the price" would
  // contradict the whole reject-and-redirect idea. Skip the price check for them.
  const isSecondary = listing.tier === "secondary";
  if (!isSecondary && fair > 0 && asking >= fair * OVERPRICED_RATIO) {
    return {
      ...base,
      action: "reprice_down",
      urgency: "medium",
      headline: `Your price is ${Math.abs(gapPercent)}% above the market estimate`,
      reasons: [
        `Market estimate: LKR ${round2(fair)}/kg. You are asking LKR ${round2(asking)}/kg.`,
        "Buyers compare prices — listings well above the market tend to be skipped, and produce loses freshness while waiting.",
        ...(trend && trend.percent <= TREND_DOWN_PERCENT ? [`Recent sales prices are also falling (${trend.percent}%).`] : []),
      ],
    };
  }
  if (!isSecondary && fair > 0 && asking <= fair * UNDERPRICED_RATIO) {
    return {
      ...base,
      action: "reprice_up",
      urgency: "medium",
      headline: `You may be underpricing by ${Math.abs(gapPercent)}%`,
      reasons: [
        `Market estimate: LKR ${round2(fair)}/kg. You are asking LKR ${round2(asking)}/kg.`,
        "Raising your price toward the market estimate could earn more without losing the sale.",
      ],
    };
  }

  // Flash-sale listings exist to move defective/rejected produce QUICKLY, so
  // "hold and wait for a better price" is the wrong advice for them.
  if (isSecondary) {
    return {
      ...base,
      action: "steady",
      urgency: "none",
      headline: "Flash sale — priced to sell quickly",
      reasons: [
        "This listing was marked down after a buyer rejection, so it is already priced to move.",
        "Factories, restaurants and compost hubs can buy it straight away from the Secondary Market.",
      ],
    };
  }

  // ---- 3. Timing: is waiting likely to pay? ----
  // The clock for holding starts at harvest (or today if already harvested).
  const startOfHold = freshNow.state === "not_harvested" ? new Date(listing.harvestDate) : now;
  const freshAtStart = computeFreshness(listing, startOfHold);
  const maxHoldDays = Math.max(0, Math.min(MAX_HOLD_DAYS, freshAtStart.daysLeft - 2));

  let calendarGain = 0;
  let calendarHoldDays = 0;
  let calendarEvent = null;
  if (maxHoldDays >= 1) {
    const priceStart = interpolatePrice(forecast.points, startOfHold);
    const startFactor = computeFreshness(listing, startOfHold).priceFactor;
    for (let d = 1; d <= maxHoldDays; d++) {
      const when = new Date(startOfHold.getTime() + d * MS_PER_DAY);
      const priceWhen = interpolatePrice(forecast.points, when);
      const factorWhen = computeFreshness(listing, when).priceFactor;
      // Net gain AFTER accounting for the freshness discount of waiting.
      const net = ((priceWhen * factorWhen) / (priceStart * startFactor) - 1) * 100;
      if (net > calendarGain) {
        calendarGain = net;
        calendarHoldDays = d;
      }
    }
    if (calendarGain >= CALENDAR_HOLD_GAIN_PERCENT) {
      const idx = forecast.points.findIndex((p) => p.event && new Date(p.date) >= startOfHold);
      calendarEvent = idx >= 0 ? forecast.points[idx].event : null;
    }
  }

  const trendPercent = trend ? trend.percent : null;
  const supplyIsHigh = saturationLevel === "high";

  if (calendarGain >= CALENDAR_HOLD_GAIN_PERCENT && calendarHoldDays >= 1 && !supplyIsHigh) {
    const holdUntil = new Date(startOfHold.getTime() + calendarHoldDays * MS_PER_DAY);
    return {
      ...base,
      action: "hold",
      urgency: "low",
      headline: `Hold ${calendarHoldDays} day${calendarHoldDays === 1 ? "" : "s"} — price may rise about ${round1(calendarGain)}%`,
      holdUntil: holdUntil.toISOString(),
      reasons: [
        `The forecast rises ${round1(calendarGain)}% by ${holdUntil.toISOString().slice(0, 10)}${calendarEvent ? ` (${calendarEvent})` : ""}, even after the small freshness discount for waiting.`,
        `Your produce stays fresh for about ${freshAtStart.daysLeft} more day(s), so a short wait is safe.`,
      ],
    };
  }

  if (trendPercent !== null && trendPercent >= TREND_UP_PERCENT && freshAtStart.daysLeft >= 4 && !supplyIsHigh) {
    const holdDays = Math.min(MAX_TREND_HOLD_DAYS, freshAtStart.daysLeft - 2);
    const holdUntil = new Date(startOfHold.getTime() + holdDays * MS_PER_DAY);
    return {
      ...base,
      action: "hold",
      urgency: "low",
      headline: `Prices are climbing (+${trendPercent}%) — hold ${holdDays} day${holdDays === 1 ? "" : "s"}`,
      holdUntil: holdUntil.toISOString(),
      reasons: [
        `Recent completed sales for ${listing.cropType} are ${trendPercent}% higher than the month before.`,
        `Your produce has about ${freshAtStart.daysLeft} day(s) of freshness left, so a short wait is safe.`,
        "This is based on recent trends, not a guarantee — sell sooner if a good offer comes.",
      ],
    };
  }

  // ---- 4. Soft-market warnings ----
  if ((trendPercent !== null && trendPercent <= TREND_DOWN_PERCENT) || supplyIsHigh) {
    if (trendPercent !== null && trendPercent <= TREND_DOWN_PERCENT) {
      reasons.push(`Recent completed sales for ${listing.cropType} are ${Math.abs(trendPercent)}% lower than the month before.`);
    }
    if (supplyIsHigh) {
      reasons.push("Many farmers in your district are growing the same crop, so more supply is likely to reach buyers soon.");
    }
    reasons.push("Selling earlier, before the extra supply arrives, usually protects the price.");
    return {
      ...base,
      action: "sell_now",
      urgency: "medium",
      headline: "Market is softening — sell soon",
      reasons,
    };
  }

  // ---- 5. Nothing special: price is fair and there is no reason to wait ----
  return {
    ...base,
    action: "steady",
    urgency: "none",
    headline: "Price is in line with the market",
    reasons: [
      `Market estimate: LKR ${round2(fair)}/kg — very close to your asking price.`,
      "No strong reason to rush or to wait. Sell when a buyer is ready.",
    ],
  };
}

const URGENCY_ORDER = { high: 0, medium: 1, low: 2, none: 3 };

function sortByUrgency(advice) {
  return [...advice].sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]);
}

module.exports = { adviseListing, sortByUrgency };
