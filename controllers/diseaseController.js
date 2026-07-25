const DiseaseLog = require("../models/DiseaseLog");

const KINDWISE_ENDPOINT = "https://crop.kindwise.com/api/v1/identification";
const OUTBREAK_RADIUS_METERS = 10000; // 10km cluster radius
const OUTBREAK_LOOKBACK_DAYS = 21;
const OUTBREAK_THRESHOLD_COUNT = 5; // number of matching logs in cluster to declare an outbreak

/**
 * POST /api/disease/scan
 * Body: { farmer, timelineRef, cropType, imageBase64, latitude, longitude, district }
 *
 * imageBase64 should be a data URI, e.g. "data:image/jpeg;base64,/9j/4AAQ..."
 *
 * Sends the photo to Kindwise's crop.health identification API, stores the
 * result in disease_logs with a GeoJSON point, then runs a geospatial
 * cluster check: if 5+ logs of the SAME disease appear within 10km in the
 * last 21 days, every log in that cluster is flagged as part of an active
 * outbreak and the response includes an outbreak alert for the frontend
 * to broadcast to nearby farmers.
 */
async function scanCropImage(req, res) {
  try {
    const { farmer, timelineRef, cropType, imageBase64, latitude, longitude, district } = req.body;

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
    const suggestions = kindwiseData?.result?.disease?.suggestions || [];

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

    // ---- Log this scan ----
    const diseaseLog = await DiseaseLog.create({
      farmer,
      timelineRef,
      cropType,
      imageUrl: "stored_client_side", // swap for real cloud storage URL (S3/Cloudinary) in production
      detectedDisease,
      confidenceScore,
      location: { type: "Point", coordinates: [longitude, latitude] },
      district,
      recommendedTreatment: treatment ? JSON.stringify(treatment) : null,
    });

    // ---- Regional outbreak cluster check ----
    const since = new Date();
    since.setDate(since.getDate() - OUTBREAK_LOOKBACK_DAYS);

    const nearbyMatches = await DiseaseLog.find({
      cropType,
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

    return res.status(201).json({
      success: true,
      data: {
        diseaseLogId: diseaseLog._id,
        detectedDisease,
        confidenceScore,
        severity: topMatch.details?.severity || null,
        symptoms: topMatch.details?.symptoms || null,
        treatment,
        outbreakAlert,
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
