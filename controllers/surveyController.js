const mongoose = require("mongoose");
const Survey = require("../models/Survey");
const SurveyResponse = require("../models/SurveyResponse");
const User = require("../models/User");
const { checkContent, cleanText, canonicalDistrict } = require("../utils/chatConfig");

const DEMO_EMAIL_SUFFIX = "@neighbour.demo.agrilink.lk";

function fail(res, status, message, code) {
  return res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
}

function shapeSurvey(s) {
  return { id: String(s._id), title: s.title, intro: s.intro, closesAt: s.closesAt, questions: s.questions.map((q) => ({ key: q.key, kind: q.kind, text: q.text, options: q.options, unit: q.unit, required: q.required })) };
}

/** GET /api/surveys/open — surveys I can still answer. */
async function openSurveys(req, res) {
  try {
    const me = await User.findById(req.userId).select("farmerProfile.district");
    const district = canonicalDistrict(me && me.farmerProfile ? me.farmerProfile.district : "");
    const answered = (await SurveyResponse.find({ respondent: req.userId }).select("survey").lean()).map((r) => String(r.survey));
    const now = new Date();
    const all = await Survey.find({ isActive: true }).sort({ createdAt: -1 }).limit(20);
    const open = all.filter((s) => !answered.includes(String(s._id)) && (!s.closesAt || s.closesAt > now) && (s.audienceDistricts.length === 0 || (district && s.audienceDistricts.includes(district))));
    return res.status(200).json({ success: true, data: open.map(shapeSurvey) });
  } catch (error) {
    console.error("openSurveys error:", error);
    return fail(res, 500, "Failed to load surveys.");
  }
}

/** POST /api/surveys/:id/respond { answers: { <questionKey>: value } } */
async function respond(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 400, "Invalid survey.");
    const survey = await Survey.findById(req.params.id);
    if (!survey || !survey.isActive || (survey.closesAt && survey.closesAt < new Date())) return fail(res, 404, "This survey is closed.");
    const raw = (req.body || {}).answers;
    if (!raw || typeof raw !== "object") return fail(res, 400, "Answers are required.");

    const answers = {};
    for (const q of survey.questions) {
      const v = raw[q.key];
      const empty = v === undefined || v === null || v === "";
      if (empty) { if (q.required) return fail(res, 400, `Please answer: ${q.text}`, "missing"); continue; }
      if (q.kind === "single") {
        if (!q.options.includes(v)) return fail(res, 400, "Choose one of the options.", "bad_answer");
        answers[q.key] = v;
      } else if (q.kind === "number") {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 10000000) return fail(res, 400, "Enter a sensible number.", "bad_answer");
        answers[q.key] = n;
      } else if (q.kind === "scale") {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 5) return fail(res, 400, "Choose 1 to 5.", "bad_answer");
        answers[q.key] = n;
      } else {
        const text = cleanText(String(v), 300);
        if (!checkContent(text).ok) return fail(res, 400, "Please don't include phone numbers, links or bad words.", "bad_text");
        answers[q.key] = text;
      }
    }
    const me = await User.findById(req.userId).select("farmerProfile.district");
    try {
      await SurveyResponse.create({ survey: survey._id, respondent: req.userId, district: canonicalDistrict(me && me.farmerProfile ? me.farmerProfile.district : "") || "", answers });
    } catch (error) {
      if (error.code === 11000) return fail(res, 409, "You already answered this survey.", "already");
      throw error;
    }
    return res.status(201).json({ success: true, message: "Thank you! Your answer helps every farmer." });
  } catch (error) {
    console.error("respond error:", error);
    return fail(res, 500, "Failed to save your answers.");
  }
}

// ---------------- admin ----------------

/** POST /api/admin/surveys */
async function createSurvey(req, res) {
  try {
    const { title, intro, questions, audienceDistricts, closesAt } = req.body || {};
    if (!title || !Array.isArray(questions) || questions.length === 0 || questions.length > 8) return fail(res, 400, "A title and 1–8 questions are required.");
    const keys = new Set();
    const cleaned = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q || !q.text || !["single", "number", "scale", "text"].includes(q.kind)) return fail(res, 400, `Question ${i + 1} is not valid.`);
      if (q.kind === "single" && (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 8)) return fail(res, 400, `Question ${i + 1} needs 2–8 options.`);
      const key = `q${i + 1}`;
      keys.add(key);
      cleaned.push({ key, kind: q.kind, text: String(q.text).slice(0, 200), options: q.kind === "single" ? q.options.map((o) => String(o).slice(0, 60)) : [], unit: String(q.unit || "").slice(0, 12), required: q.required !== false });
    }
    const survey = await Survey.create({ title: String(title).slice(0, 120), intro: String(intro || "").slice(0, 300), questions: cleaned, audienceDistricts: (audienceDistricts || []).map(canonicalDistrict).filter(Boolean), closesAt: closesAt ? new Date(closesAt) : undefined, createdBy: req.userId });
    return res.status(201).json({ success: true, data: shapeSurvey(survey) });
  } catch (error) {
    console.error("createSurvey error:", error);
    return fail(res, 500, "Failed to create the survey.");
  }
}

async function listSurveys(req, res) {
  try {
    const surveys = await Survey.find({}).sort({ createdAt: -1 }).limit(50);
    const data = [];
    for (const s of surveys) data.push({ ...shapeSurvey(s), isActive: s.isActive, responses: await SurveyResponse.countDocuments({ survey: s._id }), createdAt: s.createdAt });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("listSurveys error:", error);
    return fail(res, 500, "Failed to load surveys.");
  }
}

async function setSurveyActive(req, res) {
  try {
    const result = await Survey.updateOne({ _id: req.params.id }, { $set: { isActive: Boolean((req.body || {}).isActive) } });
    if (!result.matchedCount) return fail(res, 404, "Survey not found.");
    return res.status(200).json({ success: true });
  } catch (error) {
    return fail(res, 500, "Failed to update the survey.");
  }
}

function median(sorted) {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Turns the raw responses into per-question numbers. Built from plain queries so it works on any Mongo-compatible database. */
async function buildResults(survey) {
  const responses = await SurveyResponse.find({ survey: survey._id }).lean();
  const users = await User.find({ _id: { $in: responses.map((r) => r.respondent) } }).select("email").lean();
  const demoIds = new Set(users.filter((u) => String(u.email).endsWith(DEMO_EMAIL_SUFFIX)).map((u) => String(u._id)));
  const demoCount = responses.filter((r) => demoIds.has(String(r.respondent))).length;

  const questions = survey.questions.map((q) => {
    const values = responses.map((r) => r.answers[q.key]).filter((v) => v !== undefined && v !== null);
    const base = { key: q.key, kind: q.kind, text: q.text, unit: q.unit, answered: values.length };
    if (q.kind === "single") {
      const counts = Object.fromEntries(q.options.map((o) => [o, 0]));
      values.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
      return { ...base, counts };
    }
    if (q.kind === "number" || q.kind === "scale") {
      const nums = values.map(Number).sort((a, b) => a - b);
      const mean = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      const byDistrict = {};
      responses.forEach((r) => { const v = r.answers[q.key]; if (v === undefined || !r.district) return; (byDistrict[r.district] = byDistrict[r.district] || []).push(Number(v)); });
      const districtMeans = Object.entries(byDistrict).map(([district, arr]) => ({ district, mean: Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10, n: arr.length })).sort((a, b) => b.mean - a.mean);
      return { ...base, mean: Math.round(mean * 10) / 10, median: median(nums), min: nums[0] ?? 0, max: nums[nums.length - 1] ?? 0, districtMeans };
    }
    return { ...base, samples: values.slice(-12) };
  });
  return { survey: { id: String(survey._id), title: survey.title, isActive: survey.isActive }, totalResponses: responses.length, demoResponses: demoCount, realResponses: responses.length - demoCount, questions, responses };
}

/** GET /api/admin/surveys/:id/results */
async function surveyResults(req, res) {
  try {
    const survey = await Survey.findById(req.params.id);
    if (!survey) return fail(res, 404, "Survey not found.");
    const { responses, ...results } = await buildResults(survey);
    return res.status(200).json({ success: true, data: results });
  } catch (error) {
    console.error("surveyResults error:", error);
    return fail(res, 500, "Failed to load results.");
  }
}

/** GET /api/admin/surveys/:id/export — the answers as a CSV file (no names, only district). */
async function surveyCsv(req, res) {
  try {
    const survey = await Survey.findById(req.params.id);
    if (!survey) return fail(res, 404, "Survey not found.");
    const { responses } = await buildResults(survey);
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["submitted", "district", ...survey.questions.map((q) => q.text)].map(esc).join(",");
    const rows = responses.map((r) => [new Date(r.createdAt).toISOString(), r.district, ...survey.questions.map((q) => r.answers[q.key])].map(esc).join(","));
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="survey-${survey._id}.csv"`);
    return res.status(200).send("\uFEFF" + [header, ...rows].join("\n"));
  } catch (error) {
    console.error("surveyCsv error:", error);
    return fail(res, 500, "Failed to export.");
  }
}

module.exports = { openSurveys, respond, createSurvey, listSurveys, setSurveyActive, surveyResults, surveyCsv };
