const { predictPrice } = require("../utils/pricePredictionEngine");

/**
 * GET /api/price-predict/:cropType
 * Optional query params: targetDate (ISO string), heavyRainRiskPercent,
 * droughtRiskPercent, floodWarning (true/false).
 *
 * In production, weatherSummary should be fetched server-side from a live
 * weather API (e.g. Open-Meteo) keyed by the farmer's district. For this
 * foundational layer, the route accepts weather signals as query params so
 * it is testable end-to-end without an external API key.
 */
async function getPricePrediction(req, res) {
  try {
    const { cropType } = req.params;
    const { targetDate, heavyRainRiskPercent, droughtRiskPercent, floodWarning } = req.query;

    if (!cropType) {
      return res.status(400).json({ success: false, message: "cropType is required." });
    }

    const weatherSummary = {
      heavyRainRiskPercent: heavyRainRiskPercent ? Number(heavyRainRiskPercent) : 0,
      droughtRiskPercent: droughtRiskPercent ? Number(droughtRiskPercent) : 0,
      floodWarning: floodWarning === "true",
    };

    const prediction = await predictPrice({
      cropType,
      targetDate: targetDate ? new Date(targetDate) : new Date(),
      weatherSummary,
    });

    return res.status(200).json({ success: true, data: prediction });
  } catch (error) {
    console.error("getPricePrediction error:", error);
    return res.status(500).json({ success: false, message: "Failed to generate price prediction.", error: error.message });
  }
}

module.exports = { getPricePrediction };
