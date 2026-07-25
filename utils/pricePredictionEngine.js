const MarketplaceListing = require("../models/MarketplaceListing");
const DiseaseLog = require("../models/DiseaseLog");

/**
 * Sri Lankan demand-impacting calendar events.
 * "demandMultiplier" > 1 means historically higher demand/price around that window.
 * Dates use MM-DD format and a +/- day window.
 */
const SRI_LANKAN_DEMAND_CALENDAR = [
  { name: "Avurudu (Sinhala & Tamil New Year)", month: 4, day: 13, windowDays: 10, demandMultiplier: 1.35 },
  { name: "Vesak", month: 5, day: 23, windowDays: 5, demandMultiplier: 1.15 },
  { name: "Christmas / New Year", month: 12, day: 25, windowDays: 12, demandMultiplier: 1.30 },
  { name: "Deepavali", month: 11, day: 1, windowDays: 5, demandMultiplier: 1.10 },
  { name: "Ramadan / Eid window", month: 3, day: 30, windowDays: 20, demandMultiplier: 1.12 },
];

function getCalendarMultiplier(targetDate) {
  const month = targetDate.getMonth() + 1;
  const day = targetDate.getDate();
  let bestMultiplier = 1.0;
  let matchedEvent = null;

  for (const event of SRI_LANKAN_DEMAND_CALENDAR) {
    const eventDate = new Date(targetDate.getFullYear(), event.month - 1, event.day);
    const diffDays = Math.abs((targetDate - eventDate) / (1000 * 60 * 60 * 24));
    if (diffDays <= event.windowDays && event.demandMultiplier > bestMultiplier) {
      bestMultiplier = event.demandMultiplier;
      matchedEvent = event.name;
    }
  }
  return { multiplier: bestMultiplier, matchedEvent };
}

/**
 * Pulls historical sold-price average for a crop over the last N days.
 */
async function getHistoricalAveragePrice(cropType, lookbackDays = 90) {
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - lookbackDays);

  const result = await MarketplaceListing.aggregate([
    {
      $match: {
        cropType: cropType,
        status: "sold",
        updatedAt: { $gte: sinceDate },
      },
    },
    {
      $group: {
        _id: "$cropType",
        avgPrice: { $avg: "$currentPricePerKg" },
        minPrice: { $min: "$currentPricePerKg" },
        maxPrice: { $max: "$currentPricePerKg" },
        sampleSize: { $sum: 1 },
      },
    },
  ]);

  if (result.length === 0) {
    return { avgPrice: null, minPrice: null, maxPrice: null, sampleSize: 0 };
  }
  return result[0];
}

/**
 * Estimates a "regional shortage" factor by counting active listings
 * for the crop in the last 14 days versus the prior 14-day period.
 * Fewer recent listings relative to the baseline implies scarcity -> price up.
 */
async function getRegionalShortageFactor(cropType) {
  const now = new Date();
  const last14 = new Date(now);
  last14.setDate(now.getDate() - 14);
  const prev14Start = new Date(now);
  prev14Start.setDate(now.getDate() - 28);
  const prev14End = last14;

  const [recentCount, priorCount] = await Promise.all([
    MarketplaceListing.countDocuments({ cropType, createdAt: { $gte: last14 } }),
    MarketplaceListing.countDocuments({ cropType, createdAt: { $gte: prev14Start, $lt: prev14End } }),
  ]);

  if (priorCount === 0) {
    return { shortageMultiplier: 1.0, recentCount, priorCount };
  }

  const supplyRatio = recentCount / priorCount;
  // If supply dropped by >30%, treat as a shortage signal and inflate price.
  let shortageMultiplier = 1.0;
  if (supplyRatio < 0.7) shortageMultiplier = 1.2;
  else if (supplyRatio < 0.9) shortageMultiplier = 1.08;
  else if (supplyRatio > 1.3) shortageMultiplier = 0.92; // oversupply -> price down

  return { shortageMultiplier, recentCount, priorCount, supplyRatio };
}

/**
 * Weather disruption factor - accepts a pre-fetched weather summary object
 * (from an external weather API call made by the route handler) and converts
 * disruptive conditions (heavy rain, drought flag, flood risk) into a multiplier.
 */
function getWeatherDisruptionMultiplier(weatherSummary) {
  if (!weatherSummary) return { multiplier: 1.0, reason: "no_weather_data" };

  const { heavyRainRiskPercent = 0, droughtRiskPercent = 0, floodWarning = false } = weatherSummary;

  if (floodWarning) return { multiplier: 1.25, reason: "flood_warning_active" };
  if (heavyRainRiskPercent > 70) return { multiplier: 1.15, reason: "heavy_rain_risk" };
  if (droughtRiskPercent > 70) return { multiplier: 1.18, reason: "drought_risk" };
  if (heavyRainRiskPercent > 40 || droughtRiskPercent > 40) return { multiplier: 1.05, reason: "moderate_weather_risk" };

  return { multiplier: 1.0, reason: "stable_weather" };
}

/**
 * Regional disease pressure factor - crops with active outbreak clusters
 * historically see reduced supply reaching market -> upward price pressure.
 */
async function getDiseasePressureMultiplier(cropType) {
  const since = new Date();
  since.setDate(since.getDate() - 21);

  const activeOutbreakClusters = await DiseaseLog.countDocuments({
    cropType,
    isPartOfOutbreakAlert: true,
    createdAt: { $gte: since },
  });

  if (activeOutbreakClusters >= 5) return { multiplier: 1.15, activeOutbreakClusters };
  if (activeOutbreakClusters >= 1) return { multiplier: 1.05, activeOutbreakClusters };
  return { multiplier: 1.0, activeOutbreakClusters };
}

/**
 * MAIN AGGREGATION ROUTINE
 * Combines: historical baseline, calendar demand, regional shortage,
 * weather disruption, and disease pressure into one weighted prediction.
 */
async function predictPrice({ cropType, targetDate = new Date(), weatherSummary = null }) {
  const [historical, shortage, disease] = await Promise.all([
    getHistoricalAveragePrice(cropType),
    getRegionalShortageFactor(cropType),
    getDiseasePressureMultiplier(cropType),
  ]);

  const calendar = getCalendarMultiplier(new Date(targetDate));
  const weather = getWeatherDisruptionMultiplier(weatherSummary);

  // Fallback baseline if no historical sales exist yet for this crop.
  const baselinePrice = historical.avgPrice !== null ? historical.avgPrice : 100;

  // Weighted composite: each factor nudges the baseline. Weights sum to 1.0
  // across the four adjustment factors, applied multiplicatively for compounding effects.
  const compositeMultiplier =
    1 +
    (calendar.multiplier - 1) * 0.35 +
    (shortage.shortageMultiplier - 1) * 0.3 +
    (weather.multiplier - 1) * 0.25 +
    (disease.multiplier - 1) * 0.1;

  const predictedPrice = Math.round(baselinePrice * compositeMultiplier * 100) / 100;

  // Confidence scales with historical sample size — more data, more trust.
  let confidence = "low";
  if (historical.sampleSize >= 30) confidence = "high";
  else if (historical.sampleSize >= 10) confidence = "medium";

  return {
    cropType,
    targetDate,
    predictedPricePerKg: predictedPrice,
    confidence,
    baselinePrice,
    factors: {
      historical,
      calendarEvent: calendar.matchedEvent,
      calendarMultiplier: calendar.multiplier,
      shortage,
      weather,
      disease,
    },
    compositeMultiplier: Math.round(compositeMultiplier * 1000) / 1000,
  };
}

module.exports = {
  predictPrice,
  getHistoricalAveragePrice,
  getRegionalShortageFactor,
  getWeatherDisruptionMultiplier,
  getDiseasePressureMultiplier,
  getCalendarMultiplier,
};
