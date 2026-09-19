const { predictPrice, getCalendarMultiplier } = require("./pricePredictionEngine");

/**
 * PRICE FORECAST (powers the forecast chart in the app)
 *
 * The existing price engine already knows how to price a crop for ANY target
 * date. The only ingredient that changes with the date is the Sri Lankan
 * calendar (Avurudu, Vesak, Deepavali, Christmas...). Supply pressure,
 * weather and disease pressure are "today's conditions". So instead of
 * running the whole engine 13 times, we run it once for today and then
 * only re-apply the calendar factor for each future week, using exactly
 * the same weights as the engine (calendar 35%, shortage 30%, weather 25%,
 * disease 10%).
 *
 * This is a transparent, rule-based forecast — NOT a machine-learning model.
 * It says so to the farmer via the `method` field.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const WEIGHTS = { calendar: 0.35, shortage: 0.3, weather: 0.25, disease: 0.1 };

function round2(n) {
  return Math.round(n * 100) / 100;
}

function composite({ calendar, shortage, weather, disease }) {
  return (
    1 +
    (calendar - 1) * WEIGHTS.calendar +
    (shortage - 1) * WEIGHTS.shortage +
    (weather - 1) * WEIGHTS.weather +
    (disease - 1) * WEIGHTS.disease
  );
}

/**
 * Price at any date, by straight-line interpolation between the weekly
 * points (dates outside the range use the nearest end).
 */
function interpolatePrice(points, date) {
  if (!points || points.length === 0) return null;
  const t = new Date(date).getTime();
  if (t <= new Date(points[0].date).getTime()) return points[0].pricePerKg;
  const last = points[points.length - 1];
  if (t >= new Date(last.date).getTime()) return last.pricePerKg;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    if (t >= ta && t <= tb) {
      const ratio = (t - ta) / (tb - ta);
      return round2(a.pricePerKg + (b.pricePerKg - a.pricePerKg) * ratio);
    }
  }
  return last.pricePerKg;
}

function buildDrivers(factors, calendarMultiplier, calendarEvent) {
  const drivers = [];
  const add = (key, label, multiplier, weight) => {
    const impactPercent = Math.round((multiplier - 1) * weight * 1000) / 10;
    if (Math.abs(impactPercent) >= 0.1) drivers.push({ key, label, impactPercent });
  };

  add("calendar", calendarEvent ? `Festival demand (${calendarEvent})` : "Festival demand", calendarMultiplier, WEIGHTS.calendar);

  const shortage = factors.shortage.shortageMultiplier;
  add("supply", shortage < 1 ? "Oversupply in the market" : "Falling supply (shortage)", shortage, WEIGHTS.shortage);

  add("weather", "Weather disruption risk", factors.weather.multiplier, WEIGHTS.weather);
  add("disease", "Disease outbreaks reducing supply", factors.disease.multiplier, WEIGHTS.disease);
  return drivers;
}

/**
 * @param {string} cropType
 * @param {{weeks?: number, startDate?: Date}} options
 */
async function buildForecast(cropType, { weeks = 12, startDate = new Date() } = {}) {
  const base = await predictPrice({ cropType, targetDate: startDate });
  const factors = base.factors;
  const shortage = factors.shortage.shortageMultiplier;
  const weather = factors.weather.multiplier;
  const disease = factors.disease.multiplier;

  const points = [];
  for (let week = 0; week <= weeks; week++) {
    const date = new Date(startDate.getTime() + week * 7 * MS_PER_DAY);
    const cal = getCalendarMultiplier(date);
    const multiplier = composite({ calendar: cal.multiplier, shortage, weather, disease });
    points.push({
      date: date.toISOString(),
      weekOffset: week,
      pricePerKg: round2(base.baselinePrice * multiplier),
      event: cal.matchedEvent,
    });
  }

  const today = points[0].pricePerKg;
  let peak = points[0];
  let low = points[0];
  for (const p of points) {
    if (p.pricePerKg > peak.pricePerKg) peak = p;
    if (p.pricePerKg < low.pricePerKg) low = p;
  }

  const todayCal = getCalendarMultiplier(startDate);

  return {
    cropType,
    method: "rule_based",
    confidence: base.confidence,
    baselineSource: base.baselineSource,
    baselinePrice: base.baselinePrice,
    todayPricePerKg: today,
    peak: {
      date: peak.date,
      pricePerKg: peak.pricePerKg,
      changePercent: today > 0 ? Math.round(((peak.pricePerKg - today) / today) * 1000) / 10 : 0,
      event: peak.event,
    },
    low: {
      date: low.date,
      pricePerKg: low.pricePerKg,
      changePercent: today > 0 ? Math.round(((low.pricePerKg - today) / today) * 1000) / 10 : 0,
    },
    drivers: buildDrivers(factors, todayCal.multiplier, todayCal.matchedEvent),
    points,
  };
}

module.exports = { buildForecast, interpolatePrice, composite, WEIGHTS };
