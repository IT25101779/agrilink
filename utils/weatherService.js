/**
 * Fetches real weather forecast data from Open-Meteo (open-meteo.com).
 * No API key required — free for non-commercial and most commercial use.
 */
async function getForecast(latitude, longitude, days = 3) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=precipitation_probability_max,precipitation_sum,temperature_2m_max,temperature_2m_min&forecast_days=${days}&timezone=auto`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo request failed with status ${response.status}`);
  }
  const data = await response.json();

  const daily = data.daily;
  if (!daily || !daily.time) {
    throw new Error("Unexpected Open-Meteo response shape.");
  }

  return daily.time.map((date, i) => ({
    date,
    rainProbabilityPercent: daily.precipitation_probability_max?.[i] ?? 0,
    rainSumMm: daily.precipitation_sum?.[i] ?? 0,
    tempMaxC: daily.temperature_2m_max?.[i] ?? null,
    tempMinC: daily.temperature_2m_min?.[i] ?? null,
  }));
}

/**
 * Classifies a forecast into simple, farmer-relevant signals used by the
 * reminder engine — kept intentionally simple/heuristic rather than a
 * full agronomic model, which is out of scope for a hackathon prototype.
 */
function classifyForecast(forecastDays) {
  const tomorrow = forecastDays[1] || forecastDays[0];
  const next3Days = forecastDays.slice(0, 3);

  const heavyRainTomorrow = tomorrow && tomorrow.rainProbabilityPercent >= 60;
  const noRainNext3Days = next3Days.every((d) => d.rainProbabilityPercent < 20);
  const heatWave = next3Days.some((d) => d.tempMaxC !== null && d.tempMaxC >= 35);

  return { heavyRainTomorrow, noRainNext3Days, heatWave, tomorrow };
}

module.exports = { getForecast, classifyForecast };
