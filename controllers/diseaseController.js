const DiseaseLog = require("../models/DiseaseLog");
const { translateFields } = require("../utils/translateText");

const KINDWISE_ENDPOINT = "https://crop.kindwise.com/api/v1/identification";
const OUTBREAK_RADIUS_METERS = 10000; // 10km cluster radius
const OUTBREAK_LOOKBACK_DAYS = 21;
const OUTBREAK_THRESHOLD_COUNT = 5; // number of matching logs in cluster to declare an outbreak
// Matches a crop name ignoring capital letters and stray spaces, so a farmer
// typing "tomato", "Tomato " or "TOMATO" all count as the same crop when the
// server looks for an outbreak cluster.
function cropNameMatcher(name) {
  const escaped = String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}$`, "i");
}

const MIN_CONFIDENCE_TO_LOG = 0.3; // below this, a guess is shown to the farmer but NOT stored or counted toward outbreaks

/**
 * POST /api/disease/scan
 * Body: { farmer, timelineRef, cropType, imageBase64, latitude, longitude, district, language? }
 *
 * imageBase64 should be a data URI, e.g. "data:image/jpeg;base64,/9j/4AAQ..."
 *
 * Sends the photo to Kindwise's crop.health identification API, stores the
 * result in disease_logs with a GeoJSON point, then runs a geospatial
 * cluster check: if 5+ logs of the SAME disease appear within 10km in the
 * last 21 days, every log in that cluster is flagged as part of an active
 * outbreak and the response includes an outbreak alert for the frontend
 * to broadcast to nearby farmers.
 *
 * LANGUAGE HANDLING: Kindwise only returns English text, and there's no
 * language parameter it accepts. If `language` is "si" or "ta", the
 * response (not the database record) is translated via Claude before
 * being sent back — see utils/translateText.js. Everything written to
 * DiseaseLog, and the outbreak-cluster matching query (which matches on
 * an exact detectedDisease string), always uses the original English
 * text, so translation never affects outbreak detection accuracy or
 * causes the same disease to be tracked as two different clusters in
 * two languages.
 */
async function scanCropImage(req, res) {
  try {
    const { farmer, timelineRef, cropType, imageBase64, latitude, longitude, district, language } = req.body;

    if (!farmer || !cropType || !imageBase64 || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: "farmer, cropType, imageBase64, latitude, and longitude are required.",
      });
    }

    if (!process.env.KINDWISE_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "KINDWISE_API_KEY is not configured on the server. Add it to your .env file.",
      });
    }

    // ---- Call the external Crop.health identification API ----
    const kindwiseResponse = await fetch(
      `${KINDWISE_ENDPOINT}?details=description,treatment,symptoms,severity&language=en`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Api-Key": process.env.KINDWISE_API_KEY,
        },
        body: JSON.stringify({
          images: [imageBase64],
          latitude,
          longitude,
          similar_images: true,
        }),
      }
    );

    if (!kindwiseResponse.ok) {
      const errorText = await kindwiseResponse.text();
      console.error("Kindwise API error:", kindwiseResponse.status, errorText);
      return res.status(502).json({
        success: false,
        message: "Crop disease identification service returned an error.",
        details: errorText,
      });
    }

    const kindwiseData = await kindwiseResponse.json();
    const kindwiseResult = kindwiseData?.result;

    // Kindwise tells us when the photo doesn't look like a plant at all
    // (a hand, a table, a blurry shot...). Say so instead of inventing a disease.
    if (kindwiseResult?.is_plant?.binary === false) {
      return res.status(422).json({
        success: false,
        message: "This photo doesn't look like a plant leaf. Please take a clear, close-up photo of the affected leaf.",
      });
    }

    // Kindwise also reports whether the plant looks healthy. Previously this
    // was ignored, so a healthy leaf could still be reported with its
    // "most likely" disease.
    if (kindwiseResult?.is_healthy?.binary === true) {
      return res.status(200).json({
        success: true,
        message: "No disease detected. Crop appears healthy.",
        data: { healthy: true },
      });
    }

    const suggestions = kindwiseResult?.disease?.suggestions || [];

    if (suggestions.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No disease detected with sufficient confidence. Crop appears healthy.",
        data: { healthy: true },
      });
    }

    const topMatch = suggestions[0];
    const detectedDisease = topMatch.name;
    const confidenceScore = topMatch.probability;
    const treatment = topMatch.details?.treatment || null;
    const severity = topMatch.details?.severity || null;
    const symptoms = topMatch.details?.symptoms || null;

    // Low-confidence guesses are still shown to the farmer (with a warning
    // flag) but are not stored or counted, so they can't create a fake
    // outbreak on the Outbreak Radar.
    const lowConfidence = typeof confidenceScore === "number" && confidenceScore < MIN_CONFIDENCE_TO_LOG;

    // ---- Log this scan (always in English — this is the canonical record) ----
    const diseaseLog = lowConfidence ? null : await DiseaseLog.create({
      farmer,
      timelineRef,
      cropType: String(cropType).trim(),
      imageUrl: "stored_client_side", // swap for real cloud storage URL (S3/Cloudinary) in production
      detectedDisease,
      confidenceScore,
      location: { type: "Point", coordinates: [longitude, latitude] },
      district,
      recommendedTreatment: treatment ? JSON.stringify(treatment) : null,
    });

    // ---- Regional outbreak cluster check (English-only matching, unaffected by translation) ----
    const since = new Date();
    since.setDate(since.getDate() - OUTBREAK_LOOKBACK_DAYS);

    const nearbyMatches = lowConfidence ? [] : await DiseaseLog.find({
      cropType: cropNameMatcher(cropType),
      detectedDisease,
      createdAt: { $gte: since },
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [longitude, latitude] },
          $maxDistance: OUTBREAK_RADIUS_METERS,
        },
      },
    });

    let outbreakAlert = null;
    if (nearbyMatches.length >= OUTBREAK_THRESHOLD_COUNT) {
      await DiseaseLog.updateMany(
        { _id: { $in: nearbyMatches.map((m) => m._id) } },
        { $set: { isPartOfOutbreakAlert: true } }
      );

      outbreakAlert = {
        disease: detectedDisease,
        cropType,
        affectedReportsCount: nearbyMatches.length,
        radiusKm: OUTBREAK_RADIUS_METERS / 1000,
        message: `${nearbyMatches.length} nearby farmers have reported ${detectedDisease} on ${cropType} in the last ${OUTBREAK_LOOKBACK_DAYS} days. This may be a regional outbreak — take preventative action.`,
      };
    }

    // Tell the matching crop + district chat group (best effort — a chat problem must never break a scan).
    if (outbreakAlert) {
      try {
        await require("./groupChatController").postOutbreakAlert({ farmerId: farmer, cropType, disease: detectedDisease, count: nearbyMatches.length });
      } catch (chatError) {
        console.error("outbreak chat alert failed:", chatError.message);
      }
    }

    // ---- Translate the OUTGOING response only, if requested ----
    let responseDiseaseName = detectedDisease;
    let responseSeverity = severity;
    let responseSymptoms = symptoms;
    let responseTreatment = treatment;
    let responseOutbreakAlert = outbreakAlert;

    if (language && language !== "en") {
      const flatPayload = { detectedDisease };
      if (typeof severity === "string") flatPayload.severity = severity;
      if (typeof symptoms === "string") flatPayload.symptoms = symptoms;
      if (typeof treatment === "string") flatPayload.treatment = treatment;
      if (outbreakAlert) flatPayload.outbreakMessage = outbreakAlert.message;

      // If treatment is a structured object (Kindwise commonly returns
      // {biological, chemical, prevention} style keys), translate each
      // string-valued field individually, prefixed so it round-trips
      // back to the right place in the object below.
      const treatmentIsObject = treatment && typeof treatment === "object";
      if (treatmentIsObject) {
        for (const [key, value] of Object.entries(treatment)) {
          if (typeof value === "string") flatPayload[`treatment__${key}`] = value;
        }
      }

      const translated = await translateFields(flatPayload, language);

      responseDiseaseName = translated.detectedDisease || detectedDisease;
      if (flatPayload.severity) responseSeverity = translated.severity;
      if (flatPayload.symptoms) responseSymptoms = translated.symptoms;
      if (flatPayload.treatment) responseTreatment = translated.treatment;
      if (treatmentIsObject) {
        responseTreatment = { ...treatment };
        for (const key of Object.keys(flatPayload)) {
          if (key.startsWith("treatment__")) {
            const originalKey = key.replace("treatment__", "");
            responseTreatment[originalKey] = translated[key] || treatment[originalKey];
          }
        }
      }
      if (outbreakAlert) {
        responseOutbreakAlert = { ...outbreakAlert, message: translated.outbreakMessage || outbreakAlert.message };
      }
    }

    return res.status(201).json({
      success: true,
      data: {
        diseaseLogId: diseaseLog ? diseaseLog._id : null,
        lowConfidence,
        detectedDisease: responseDiseaseName,
        detectedDiseaseEnglish: detectedDisease, // kept for any client-side logic that needs the canonical name
        confidenceScore,
        severity: responseSeverity,
        symptoms: responseSymptoms,
        treatment: responseTreatment,
        outbreakAlert: responseOutbreakAlert,
      },
    });
  } catch (error) {
    console.error("scanCropImage error:", error);
    return res.status(500).json({ success: false, message: "Disease scan failed.", error: error.message });
  }
}

/**
 * GET /api/disease/outbreak-alerts?latitude=X&longitude=Y&radiusKm=10
 * Lets the mobile app poll for active outbreak clusters near the farmer's location.
 */
async function getOutbreakAlerts(req, res) {
  try {
    const { latitude, longitude, radiusKm } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: "latitude and longitude are required." });
    }

    const radiusMeters = radiusKm ? Number(radiusKm) * 1000 : OUTBREAK_RADIUS_METERS;
    const since = new Date();
    since.setDate(since.getDate() - OUTBREAK_LOOKBACK_DAYS);

    const nearbyOutbreaks = await DiseaseLog.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [Number(longitude), Number(latitude)] },
          distanceField: "distanceMeters",
          maxDistance: radiusMeters,
          spherical: true,
          query: { isPartOfOutbreakAlert: true, createdAt: { $gte: since } },
        },
      },
      {
        $group: {
          _id: { cropType: "$cropType", disease: "$detectedDisease" },
          reportCount: { $sum: 1 },
          nearestDistanceMeters: { $min: "$distanceMeters" },
        },
      },
      { $sort: { reportCount: -1 } },
    ]);

    return res.status(200).json({ success: true, data: nearbyOutbreaks });
  } catch (error) {
    console.error("getOutbreakAlerts error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch outbreak alerts.", error: error.message });
  }
}

module.exports = { scanCropImage, getOutbreakAlerts };
