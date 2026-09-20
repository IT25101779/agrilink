const RainfallCache = require("../models/RainfallCache");
const { DISTRICT_COORDS } = require("./deliveryEstimate");

let fetchImpl = (...args) => fetch(...args); // replaceable in tests
function setFetch(fn) { fetchImpl = fn; }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Average rainfall (mm) for each calendar month over the last 5 full years, from the free Open-Meteo archive. Cached 60 days. */
async function monthlyRainfall(district) {
  const coords = DISTRICT_COORDS[district];
  if (!coords) return null;
  const cached = await RainfallCache.findOne({ district }).lean();
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < 60 * 24 * 3600 * 1000) return { monthlyMm: cached.monthlyMm, years: cached.years, cached: true };

  const endYear = new Date().getFullYear() - 1, startYear = endYear - 4;
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${coords[1]}&longitude=${coords[0]}&start_date=${startYear}-01-01&end_date=${endYear}-12-31&daily=precipitation_sum&timezone=Asia%2FColombo`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`rainfall service said ${res.status}`);
  const data = await res.json();
  const days = data && data.daily && data.daily.time, mm = data && data.daily && data.daily.precipitation_sum;
  if (!Array.isArray(days) || !Array.isArray(mm) || days.length !== mm.length || days.length < 365 * 3) throw new Error("rainfall data was incomplete");
  const totals = Array.from({ length: 12 }, () => ({})); // month -> { year: sum }
  days.forEach((d, i) => { const y = d.slice(0, 4), m = parseInt(d.slice(5, 7), 10) - 1; totals[m][y] = (totals[m][y] || 0) + (Number(mm[i]) || 0); });
  const monthlyMm = totals.map((byYear) => { const v = Object.values(byYear); return Math.round(v.reduce((a, b) => a + b, 0) / Math.max(v.length, 1)); });
  await RainfallCache.updateOne({ district }, { $set: { district, monthlyMm, years: endYear - startYear + 1, fetchedAt: new Date() } }, { upsert: true });
  return { monthlyMm, years: endYear - startYear + 1, cached: false };
}

/**
 * Turns the monthly averages into planting advice for the two seasons: Maha (rains from the north-east monsoon, planting
 * about Sep–Nov) and Yala (planting about Mar–May). For each season we pick the first month in the window that already gets
 * at least 100 mm on average; if none does, the wettest month in the window. This is guidance from history, not a forecast.
 */
function plantingAdvice(monthlyMm) {
  const pick = (season, window) => {
    const enough = window.find((m) => monthlyMm[m] >= 100);
    const month = enough !== undefined ? enough : window.reduce((best, m) => (monthlyMm[m] > monthlyMm[best] ? m : best), window[0]);
    return { season, plantMonth: MONTHS[month], rainMm: monthlyMm[month], reason: enough !== undefined ? "First month in the usual planting window that averages 100 mm of rain or more." : "No month in the usual window averages 100 mm, so this is the wettest one — plan for irrigation.", needsIrrigation: monthlyMm[month] < 100 };
  };
  return [pick("maha", [8, 9, 10]), pick("yala", [2, 3, 4])];
}

module.exports = { monthlyRainfall, plantingAdvice, setFetch, MONTHS };
