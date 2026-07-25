const Reminder = require("../models/Reminder");
const DiseaseLog = require("../models/DiseaseLog");
const { getForecast, classifyForecast } = require("../utils/weatherService");

const FERTILIZER_KEYWORDS = ["fertilizer", "top-up", "top up"];
const IRRIGATION_KEYWORDS = ["irrigation"];
const HARVEST_KEYWORDS = ["harvest"];
const OUTBREAK_RADIUS_METERS = 10000;
const OUTBREAK_LOOKBACK_DAYS = 21;

function matchesKeywords(title, keywords) {
  const lower = title.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

async function tryCreateReminder(data) {
  try {
    await Reminder.create(data);
    return true;
  } catch (error) {
    // Duplicate key (E11000) just means this reminder was already
    // generated earlier — that's expected and fine, not a real error.
    if (error.code !== 11000) {
      console.error("tryCreateReminder error:", error);
    }
    return false;
  }
}

/**
 * POST /api/reminders/generate
 * Body: { farmer, timelineRef, cropType, latitude, longitude, plantingDate, milestones }
 *
 * Called by the mobile app (on open, or pull-to-refresh) since it holds the
 * offline-first timeline data locally. Cross-references live weather,
 * regional disease outbreak data, and the timeline's own schedule to
 * generate contextual reminders. Safe to call repeatedly — duplicate
 * reminders are silently skipped via a dedupe key.
 */
async function generateReminders(req, res) {
  try {
    const { farmer, timelineRef, cropType, latitude, longitude, plantingDate, milestones } = req.body;

    if (!farmer || !timelineRef || !cropType || latitude === undefined || longitude === undefined || !plantingDate || !milestones) {
      return res.status(400).json({
        success: false,
        message: "farmer, timelineRef, cropType, latitude, longitude, plantingDate, and milestones are required.",
      });
    }

    const today = new Date();
    const dayNumber = Math.floor((today - new Date(plantingDate)) / (1000 * 60 * 60 * 24));
    const todayDateStr = today.toISOString().slice(0, 10);

    const createdReminders = [];

    try {
      const forecast = await getForecast(latitude, longitude, 3);
      const signals = classifyForecast(forecast);

      const upcomingActionMilestone = milestones.find(
        (m) => !m.isCompleted && Math.abs(m.day - dayNumber) <= 1
      );

      if (signals.heavyRainTomorrow && upcomingActionMilestone && matchesKeywords(upcomingActionMilestone.title, FERTILIZER_KEYWORDS)) {
        const created = await tryCreateReminder({
          farmer,
          timelineRef,
          cropType,
          type: "weather_action",
          title: "Rain expected tomorrow",
          message: `Heavy rain is forecast tomorrow (${signals.tomorrow.rainProbabilityPercent}% chance). Apply fertilizer today before the rain, or wait until conditions clear to avoid it washing away.`,
          relatedMilestoneDay: upcomingActionMilestone.day,
          dedupeKey: `${timelineRef}:weather_rain_fertilizer:${todayDateStr}`,
        });
        if (created) createdReminders.push("weather_action");
      }

      if (signals.noRainNext3Days && upcomingActionMilestone && matchesKeywords(upcomingActionMilestone.title, IRRIGATION_KEYWORDS)) {
        const created = await tryCreateReminder({
          farmer,
          timelineRef,
          cropType,
          type: "weather_action",
          title: "No rain expected — irrigate manually",
          message: "No significant rain is forecast for the next 3 days. Make sure to irrigate your crop manually to prevent moisture stress.",
          relatedMilestoneDay: upcomingActionMilestone.day,
          dedupeKey: `${timelineRef}:weather_dry_irrigate:${todayDateStr}`,
        });
        if (created) createdReminders.push("weather_action");
      }

      if (signals.heatWave) {
        const created = await tryCreateReminder({
          farmer,
          timelineRef,
          cropType,
          type: "weather_action",
          title: "Heat wave warning",
          message: "Temperatures are expected to reach 35°C+ in the next few days. Consider extra watering and shading young plants during peak heat.",
          dedupeKey: `${timelineRef}:weather_heatwave:${todayDateStr}`,
        });
        if (created) createdReminders.push("weather_action");
      }
    } catch (weatherError) {
      console.error("Weather fetch failed (non-fatal, skipping weather reminders):", weatherError.message);
    }

    const since = new Date();
    since.setDate(since.getDate() - OUTBREAK_LOOKBACK_DAYS);

    const nearbyOutbreaks = await DiseaseLog.find({
      cropType,
      isPartOfOutbreakAlert: true,
      createdAt: { $gte: since },
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [longitude, latitude] },
          $maxDistance: OUTBREAK_RADIUS_METERS,
        },
      },
    }).limit(1);

    if (nearbyOutbreaks.length > 0) {
      const outbreak = nearbyOutbreaks[0];
      const created = await tryCreateReminder({
        farmer,
        timelineRef,
        cropType,
        type: "disease_risk",
        title: `${outbreak.detectedDisease} reported nearby`,
        message: `Other farmers within 10km have reported ${outbreak.detectedDisease} on ${cropType} recently. Please inspect your crop closely and send a photo so we can check for early signs.`,
        requiresPhoto: true,
        dedupeKey: `${timelineRef}:disease_risk:${outbreak.detectedDisease}:${todayDateStr}`,
      });
      if (created) createdReminders.push("disease_risk");
    }

    const harvestMilestone = milestones.find(
      (m) => matchesKeywords(m.title, HARVEST_KEYWORDS) && !m.isCompleted && m.day - dayNumber <= 3 && m.day - dayNumber >= 0
    );
    if (harvestMilestone) {
      const created = await tryCreateReminder({
        farmer,
        timelineRef,
        cropType,
        type: "harvest_ready",
        title: `${cropType} harvest approaching`,
        message: `Your ${cropType} is expected to be ready for harvest around day ${harvestMilestone.day}. Start preparing your marketplace listing and check for buyers.`,
        relatedMilestoneDay: harvestMilestone.day,
        dedupeKey: `${timelineRef}:harvest_ready:${harvestMilestone.day}`,
      });
      if (created) createdReminders.push("harvest_ready");
    }

    const overdueMilestone = milestones
      .filter((m) => !m.isCompleted && m.day < dayNumber)
      .sort((a, b) => a.day - b.day)[0];
    if (overdueMilestone) {
      const created = await tryCreateReminder({
        farmer,
        timelineRef,
        cropType,
        type: "milestone_due",
        title: `Overdue: ${overdueMilestone.title}`,
        message: `Your "${overdueMilestone.title}" step (day ${overdueMilestone.day}) hasn't been marked complete yet. ${overdueMilestone.description || ""}`,
        relatedMilestoneDay: overdueMilestone.day,
        dedupeKey: `${timelineRef}:milestone_due:${overdueMilestone.day}`,
      });
      if (created) createdReminders.push("milestone_due");
    }

    return res.status(200).json({
      success: true,
      message: createdReminders.length > 0 ? `Generated ${createdReminders.length} new reminder(s).` : "No new reminders — everything is up to date.",
      data: { newReminderTypes: createdReminders },
    });
  } catch (error) {
    console.error("generateReminders error:", error);
    return res.status(500).json({ success: false, message: "Failed to generate reminders.", error: error.message });
  }
}

/**
 * GET /api/reminders?farmer=X&status=pending
 */
async function getReminders(req, res) {
  try {
    const { farmer, status } = req.query;
    if (!farmer) {
      return res.status(400).json({ success: false, message: "farmer is required." });
    }
    const filter = { farmer };
    if (status) filter.status = status;

    const reminders = await Reminder.find(filter).sort({ createdAt: -1 }).limit(50);
    return res.status(200).json({ success: true, count: reminders.length, data: reminders });
  } catch (error) {
    console.error("getReminders error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch reminders.", error: error.message });
  }
}

/**
 * PATCH /api/reminders/:id
 * Body: { status: "acknowledged" | "dismissed" | "photo_submitted", linkedDiseaseLogId? }
 */
async function updateReminder(req, res) {
  try {
    const { id } = req.params;
    const { status, linkedDiseaseLogId } = req.body;

    const validStatuses = ["pending", "acknowledged", "dismissed", "photo_submitted"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of: ${validStatuses.join(", ")}` });
    }

    const update = { status };
    if (linkedDiseaseLogId) update.linkedDiseaseLogId = linkedDiseaseLogId;

    const reminder = await Reminder.findByIdAndUpdate(id, update, { new: true });
    if (!reminder) {
      return res.status(404).json({ success: false, message: "Reminder not found." });
    }
    return res.status(200).json({ success: true, data: reminder });
  } catch (error) {
    console.error("updateReminder error:", error);
    return res.status(500).json({ success: false, message: "Failed to update reminder.", error: error.message });
  }
}

module.exports = { generateReminders, getReminders, updateReminder };
