const mongoose = require("mongoose");
const WildlifeSighting = require("../models/WildlifeSighting");
const AgriOffice = require("../models/AgriOffice");
const Question = require("../models/Question");
const DiseaseLog = require("../models/DiseaseLog");
const User = require("../models/User");
const { DISTRICT_COORDS, haversineKm } = require("../utils/deliveryEstimate");
const { canonicalDistrict, canonicalCrop, checkContent, cleanText } = require("../utils/chatConfig");
const { notifyFarmer } = require("../utils/notify");

const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
const validId = (id) => mongoose.isValidObjectId(String(id));
const SPECIES = ["elephant", "wild_boar", "monkey", "peacock", "porcupine", "other"];
const ALERT_RADIUS_KM = 8;

function districtsNear(lng, lat, km) {
  return Object.entries(DISTRICT_COORDS).filter(([, c]) => haversineKm([lng, lat], c) <= km).map(([name]) => name);
}

function nearestDistrict(lng, lat) {
  let best = "", bestKm = Infinity;
  for (const [name, c] of Object.entries(DISTRICT_COORDS)) { const km = haversineKm([lng, lat], c); if (km < bestKm) { bestKm = km; best = name; } }
  return best;
}

// ---------------- wildlife ----------------
/** POST /api/wildlife { species, latitude, longitude, note?, clientId? } */
async function reportSighting(req, res) {
  try {
    const b = req.body || {};
    if (!SPECIES.includes(b.species)) return fail(res, 400, "Choose the animal.");
    const lat = Number(b.latitude), lng = Number(b.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 5.6 || lat > 9.95 || lng < 79.4 || lng > 82.0) return fail(res, 400, "The location is not in Sri Lanka.", "bad_location");
    if (b.clientId && (await WildlifeSighting.exists({ reporter: req.userId, clientId: String(b.clientId) }))) return res.status(200).json({ success: true, duplicate: true });
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    if ((await WildlifeSighting.countDocuments({ reporter: req.userId, createdAt: { $gte: since } })) >= 5) return fail(res, 429, "You have reported 5 times today. Thank you!", "rate_limited");
    const note = cleanText(b.note || "", 160);
    if (note && !checkContent(note).ok) return fail(res, 400, "Please keep the note free of phone numbers and links.", "bad_text");
    const sighting = await WildlifeSighting.create({ reporter: req.userId, species: b.species, location: { type: "Point", coordinates: [lng, lat] }, district: nearestDistrict(lng, lat), note, clientId: String(b.clientId || "").slice(0, 40), expiresAt: new Date(Date.now() + 48 * 3600 * 1000) });

    // Warn farmers whose registered farm is within 8 km.
    // Candidates: farmers registered in a district within ~80 km, then the EXACT distance is measured here.
    const nearDistricts = districtsNear(lng, lat, 80);
    const candidates = await User.find({ role: "farmer", _id: { $ne: req.userId }, "farmerProfile.district": { $in: nearDistricts }, "farmerProfile.gpsLocation.coordinates.0": { $exists: true } }).select("farmerProfile.gpsLocation").limit(2000).lean();
    const neighbours = candidates.filter((c) => { const co = c.farmerProfile.gpsLocation.coordinates; return co && (co[0] || co[1]) && haversineKm([lng, lat], co) <= ALERT_RADIUS_KM; }).slice(0, 200);
    const label = { elephant: "Elephants", wild_boar: "Wild boar", monkey: "Monkeys", peacock: "Peacocks", porcupine: "Porcupines", other: "Wild animals" }[b.species];
    let warned = 0;
    for (const n of neighbours) if (await notifyFarmer(n._id, { type: "wildlife", dedupeKey: `wild-${sighting._id}`, title: `${label} reported near your farm`, message: `A farmer reported ${label.toLowerCase()} within ${ALERT_RADIUS_KM} km. Stay alert tonight and protect your crop.` })) warned++;
    return res.status(201).json({ success: true, data: { id: String(sighting._id), district: sighting.district, farmersWarned: warned } });
  } catch (error) { console.error("reportSighting error:", error); return fail(res, 500, "Failed to send the report."); }
}

/** GET /api/wildlife/nearby?latitude=&longitude=&radiusKm= */
async function nearbySightings(req, res) {
  try {
    const lat = Number(req.query.latitude), lng = Number(req.query.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail(res, 400, "latitude and longitude are required.");
    const radius = Math.min(Math.max(Number(req.query.radiusKm) || 10, 1), 30);
    const live = await WildlifeSighting.find({ expiresAt: { $gt: new Date() } }).limit(500).lean();
    const found = live.filter((x) => haversineKm([lng, lat], x.location.coordinates) <= radius);
    const list = found.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
    return res.status(200).json({ success: true, data: list.map((s) => ({ id: String(s._id), species: s.species, distanceKm: Math.round(haversineKm([lng, lat], s.location.coordinates) * 10) / 10, minutesAgo: Math.round((Date.now() - new Date(s.createdAt).getTime()) / 60000), note: s.note, district: s.district, seenBy: s.confirmedBy.length + 1, allClear: s.allClearBy.length, mine: String(s.reporter) === String(req.userId) })) });
  } catch (error) { console.error("nearbySightings error:", error); return fail(res, 500, "Failed to load sightings."); }
}

/** POST /api/wildlife/:id/confirm { kind: "seen" | "clear" } */
async function confirmSighting(req, res) {
  if (!validId(req.params.id)) return fail(res, 400, "Invalid report.");
  const s = await WildlifeSighting.findById(req.params.id);
  if (!s || s.expiresAt < new Date()) return fail(res, 404, "This report has expired.");
  if (String(s.reporter) === String(req.userId)) return fail(res, 400, "You made this report.");
  const kind = (req.body || {}).kind === "clear" ? "clear" : "seen";
  const uid = String(req.userId);
  if (kind === "seen") { if (!s.confirmedBy.some((x) => String(x) === uid)) s.confirmedBy.push(req.userId); s.allClearBy = s.allClearBy.filter((x) => String(x) !== uid); }
  else { if (!s.allClearBy.some((x) => String(x) === uid)) s.allClearBy.push(req.userId); s.confirmedBy = s.confirmedBy.filter((x) => String(x) !== uid); }
  await s.save();
  return res.status(200).json({ success: true, seenBy: s.confirmedBy.length + 1, allClear: s.allClearBy.length });
}

// ---------------- offices ----------------
async function listOffices(req, res) {
  const filter = { isActive: true };
  if (req.query.district) { const d = canonicalDistrict(req.query.district); if (!d) return fail(res, 400, "Unknown district."); filter.district = d; }
  if (req.query.kind) filter.kind = req.query.kind;
  const list = await AgriOffice.find(filter).sort({ district: 1, kind: 1, name: 1 }).limit(200).lean();
  return res.status(200).json({ success: true, data: list.map((o) => ({ id: String(o._id), name: o.name, kind: o.kind, district: o.district, phone: o.phone, address: o.address, hours: o.hours, isSample: o.isSample })) });
}
async function createOffice(req, res) {
  const b = req.body || {}; const district = canonicalDistrict(b.district);
  if (!b.name || !district || !["agrarian_service_centre", "extension_officer", "cooperative", "research_station", "government_office", "other"].includes(b.kind)) return fail(res, 400, "Name, district and kind are required.");
  const o = await AgriOffice.create({ name: String(b.name).slice(0, 100), kind: b.kind, district, phone: String(b.phone || "").slice(0, 20), address: String(b.address || "").slice(0, 200), hours: String(b.hours || "").slice(0, 80), isSample: Boolean(b.isSample) });
  return res.status(201).json({ success: true, data: { id: String(o._id) } });
}
async function updateOffice(req, res) {
  if (!validId(req.params.id)) return fail(res, 400, "Invalid id.");
  const allowed = {}; for (const k of ["name", "phone", "address", "hours", "isActive", "isSample"]) if ((req.body || {})[k] !== undefined) allowed[k] = req.body[k];
  await AgriOffice.updateOne({ _id: req.params.id }, { $set: allowed });
  return res.status(200).json({ success: true });
}
async function deleteOffice(req, res) {
  if (!validId(req.params.id)) return fail(res, 400, "Invalid id.");
  await AgriOffice.deleteOne({ _id: req.params.id });
  return res.status(200).json({ success: true });
}

// ---------------- questions for an officer ----------------
/** POST /api/help/questions { cropType?, text } */
async function askQuestion(req, res) {
  try {
    const me = await User.findById(req.userId).select("farmerProfile.district");
    const district = canonicalDistrict(me && me.farmerProfile ? me.farmerProfile.district : "");
    if (!district) return fail(res, 400, "Set your district in Profile → Edit first.", "no_district");
    const text = cleanText((req.body || {}).text || "", 500);
    if (text.length < 8) return fail(res, 400, "Please describe the problem in a few words.");
    if (!checkContent(text).ok) return fail(res, 400, "Please keep the question free of phone numbers and links.", "bad_text");
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    if ((await Question.countDocuments({ farmer: req.userId, createdAt: { $gte: since } })) >= 5) return fail(res, 429, "You have asked 5 questions today.", "rate_limited");
    const crop = (req.body || {}).cropType && req.body.cropType !== "General" ? canonicalCrop(req.body.cropType) : null;
    const q = await Question.create({ farmer: req.userId, district, cropType: crop || "General", text });
    const officers = await User.countDocuments({ role: "officer", "officerProfile.districts": district });
    return res.status(201).json({ success: true, data: { id: String(q._id), officersInDistrict: officers } });
  } catch (error) { console.error("askQuestion error:", error); return fail(res, 500, "Failed to send the question."); }
}
async function myQuestions(req, res) {
  const list = await Question.find({ farmer: req.userId }).sort({ createdAt: -1 }).limit(30).populate("answeredBy", "fullName officerProfile.title").lean();
  return res.status(200).json({ success: true, data: list.map((q) => ({ id: String(q._id), cropType: q.cropType, text: q.text, status: q.status, answer: q.answer, answeredBy: q.answeredBy ? `${q.answeredBy.fullName}${q.answeredBy.officerProfile && q.answeredBy.officerProfile.title ? ", " + q.answeredBy.officerProfile.title : ""}` : null, answeredAt: q.answeredAt, createdAt: q.createdAt })) });
}

/** GET /api/help/officer/overview — open questions + disease reports for my districts. */
async function officerOverview(req, res) {
  const me = await User.findById(req.userId).select("officerProfile fullName");
  const districts = (me.officerProfile && me.officerProfile.districts) || [];
  const questions = await Question.find({ district: { $in: districts }, status: "open" }).sort({ createdAt: 1 }).limit(60).populate("farmer", "fullName farmerProfile.district").lean();
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const logs = await DiseaseLog.find({ district: { $in: districts }, createdAt: { $gte: since } }).select("district cropType detectedDisease createdAt").lean();
  const groups = new Map();
  for (const l of logs) { const k = `${l.district}|${l.cropType}|${l.detectedDisease}`; const g = groups.get(k) || { district: l.district, cropType: l.cropType, disease: l.detectedDisease, reports: 0, latest: l.createdAt }; g.reports++; if (l.createdAt > g.latest) g.latest = l.createdAt; groups.set(k, g); }
  return res.status(200).json({ success: true, data: { districts, questions: questions.map((q) => ({ id: String(q._id), district: q.district, cropType: q.cropType, text: q.text, farmerName: q.farmer && q.farmer.fullName, createdAt: q.createdAt })), outbreaks: [...groups.values()].sort((a, b) => b.reports - a.reports) } });
}

async function answerQuestion(req, res) {
  try {
    if (!validId(req.params.id)) return fail(res, 400, "Invalid question.");
    const me = await User.findById(req.userId).select("officerProfile");
    const q = await Question.findById(req.params.id);
    if (!q) return fail(res, 404, "Question not found.");
    const districts = (me.officerProfile && me.officerProfile.districts) || [];
    if (!districts.includes(q.district)) return fail(res, 403, "This question is from a district you don't cover.");
    if (q.status === "answered") return fail(res, 409, "Already answered.");
    const answer = cleanText((req.body || {}).answer || "", 800);
    if (answer.length < 5) return fail(res, 400, "Please write an answer.");
    q.answer = answer; q.status = "answered"; q.answeredBy = req.userId; q.answeredAt = new Date(); await q.save();
    await notifyFarmer(q.farmer, { type: "officer_answer", dedupeKey: `answer-${q._id}`, cropType: q.cropType, title: "An officer answered your question", message: answer.slice(0, 120) });
    return res.status(200).json({ success: true });
  } catch (error) { console.error("answerQuestion error:", error); return fail(res, 500, "Failed to send the answer."); }
}

/** POST /api/admin/users/:id/officer { districts: [...], title } — makes someone an officer (or back to farmer with districts: []). */
async function setOfficer(req, res) {
  if (!validId(req.params.id)) return fail(res, 400, "Invalid person.");
  const districts = ((req.body || {}).districts || []).map(canonicalDistrict).filter(Boolean);
  const user = await User.findById(req.params.id).select("role");
  if (!user) return fail(res, 404, "Person not found.");
  if (["admin"].includes(user.role)) return fail(res, 409, "Admins can't be changed here.");
  if (districts.length === 0) { await User.updateOne({ _id: user._id }, { $set: { role: "farmer", "officerProfile.districts": [] } }); return res.status(200).json({ success: true, role: "farmer" }); }
  await User.updateOne({ _id: user._id }, { $set: { role: "officer", "officerProfile.districts": districts, "officerProfile.title": String((req.body || {}).title || "").slice(0, 60) } });
  return res.status(200).json({ success: true, role: "officer", districts });
}

module.exports = { reportSighting, nearbySightings, confirmSighting, listOffices, createOffice, updateOffice, deleteOffice, askQuestion, myQuestions, officerOverview, answerQuestion, setOfficer, nearestDistrict };
