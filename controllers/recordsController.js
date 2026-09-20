const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const YieldRecord = require("../models/YieldRecord");
const SubsidyRecord = require("../models/SubsidyRecord");
const SupportPrice = require("../models/SupportPrice");
const DamageReport = require("../models/DamageReport");
const MarketPrice = require("../models/MarketPrice");
const LedgerEntry = require("../models/LedgerEntry");
const TradeOrder = require("../models/TradeOrder");
const Photo = require("../models/Photo");
const User = require("../models/User");
const { canonicalCrop, canonicalDistrict, cleanText } = require("../utils/chatConfig");
const { monthlyRainfall, plantingAdvice, MONTHS } = require("../utils/rainfall");
const { computeTrust } = require("../utils/trust");
const { notifyFarmer } = require("../utils/notify");
const { decodeImage } = require("./safetyController");

const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
const validId = (id) => mongoose.isValidObjectId(String(id));
const num = (v) => (v === undefined || v === null || v === "" ? NaN : Number(v));
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

// ---------------- yields ----------------
async function addYield(req, res) {
  try {
    const b = req.body || {};
    const crop = canonicalCrop(b.cropType);
    if (!crop) return fail(res, 400, "Unknown crop.");
    if (!["yala", "maha", "other"].includes(b.season)) return fail(res, 400, "Choose Yala, Maha or other.");
    const year = parseInt(b.year, 10), acres = num(b.acres), kg = num(b.harvestKg);
    if (!(year >= 2015 && year <= new Date().getFullYear() + 1)) return fail(res, 400, "That year doesn't look right.");
    if (!(acres > 0 && acres <= 10000)) return fail(res, 400, "Enter the field size in acres.");
    if (!(kg >= 1 && kg <= 100000000)) return fail(res, 400, "Enter the harvest in kg.");
    if (kg / acres > 60000) return fail(res, 400, "That is a very high harvest for the land size. Please check the numbers.", "implausible");
    if (b.clientId) { const dup = await YieldRecord.findOne({ farmer: req.userId, clientId: String(b.clientId) }); if (dup) return res.status(200).json({ success: true, duplicate: true }); }
    const me = await User.findById(req.userId).select("farmerProfile.district");
    const r = await YieldRecord.create({ farmer: req.userId, cropType: crop, season: b.season, year, acres, harvestKg: Math.round(kg), district: (me.farmerProfile && me.farmerProfile.district) || "", note: cleanText(b.note || "", 120), clientId: String(b.clientId || "").slice(0, 40) });
    return res.status(201).json({ success: true, data: { id: String(r._id), kgPerAcre: Math.round(kg / acres) } });
  } catch (error) { console.error("addYield error:", error); return fail(res, 500, "Failed to save."); }
}

async function listYields(req, res) {
  try {
    const mine = await YieldRecord.find({ farmer: req.userId }).sort({ year: -1, createdAt: -1 }).limit(60).lean();
    const out = [];
    for (const r of mine) {
      const others = await YieldRecord.find({ cropType: r.cropType, district: r.district, farmer: { $ne: req.userId }, year: { $gte: r.year - 2 } }).select("farmer acres harvestKg").lean();
      const farmers = new Set(others.map((o) => String(o.farmer)));
      const districtKgPerAcre = farmers.size >= 3 ? Math.round(median(others.map((o) => o.harvestKg / o.acres))) : null; // never shown for fewer than 3 neighbours
      out.push({ id: String(r._id), cropType: r.cropType, season: r.season, year: r.year, acres: r.acres, harvestKg: r.harvestKg, kgPerAcre: Math.round(r.harvestKg / r.acres), districtKgPerAcre, neighbours: farmers.size, note: r.note });
    }
    return res.status(200).json({ success: true, data: out });
  } catch (error) { console.error("listYields error:", error); return fail(res, 500, "Failed to load."); }
}
async function deleteYield(req, res) {
  if (!validId(req.params.id)) return fail(res, 400, "Invalid id.");
  const r = await YieldRecord.deleteOne({ _id: req.params.id, farmer: req.userId });
  return r.deletedCount ? res.status(200).json({ success: true }) : fail(res, 404, "Not found.");
}

// ---------------- subsidies ----------------
async function addSubsidy(req, res) {
  try {
    const b = req.body || {};
    if (!["fertilizer", "seed", "cash", "equipment", "other"].includes(b.kind)) return fail(res, 400, "Choose the kind of support.");
    const received = new Date(b.receivedOn || Date.now());
    if (isNaN(received) || received.getTime() > Date.now() + 86400000 || received.getTime() < Date.now() - 5 * 365 * 86400000) return fail(res, 400, "That date doesn't look right.");
    const next = b.nextDueOn ? new Date(b.nextDueOn) : null;
    if (next && (isNaN(next) || next.getTime() < received.getTime() || next.getTime() > Date.now() + 2 * 365 * 86400000)) return fail(res, 400, "The next date doesn't look right.");
    if (b.clientId) { const dup = await SubsidyRecord.findOne({ farmer: req.userId, clientId: String(b.clientId) }); if (dup) return res.status(200).json({ success: true, duplicate: true }); }
    const r = await SubsidyRecord.create({ farmer: req.userId, kind: b.kind, item: cleanText(b.item || "", 80), quantity: Math.max(0, num(b.quantity) || 0), unit: cleanText(b.unit || "", 12), valueLkr: Math.max(0, Math.round(num(b.valueLkr) || 0)), receivedOn: received, nextDueOn: next || undefined, note: cleanText(b.note || "", 120), clientId: String(b.clientId || "").slice(0, 40) });
    return res.status(201).json({ success: true, data: { id: String(r._id) } });
  } catch (error) { console.error("addSubsidy error:", error); return fail(res, 500, "Failed to save."); }
}
/** Lists my records. Anything due within 7 days also sends ONE reminder (never repeated). */
async function listSubsidies(req, res) {
  const list = await SubsidyRecord.find({ farmer: req.userId }).sort({ receivedOn: -1 }).limit(80).lean();
  const soon = Date.now() + 7 * 86400000;
  for (const r of list) if (r.nextDueOn && new Date(r.nextDueOn).getTime() <= soon && new Date(r.nextDueOn).getTime() > Date.now() - 30 * 86400000) await notifyFarmer(req.userId, { type: "subsidy_due", dedupeKey: `subsidy-${r._id}`, title: `${r.item || r.kind} is due soon`, message: `Your next ${r.item || r.kind} support is due about ${new Date(r.nextDueOn).toISOString().slice(0, 10)}. Check with your Agrarian Service Centre.` });
  return res.status(200).json({ success: true, data: list.map((r) => ({ id: String(r._id), kind: r.kind, item: r.item, quantity: r.quantity, unit: r.unit, valueLkr: r.valueLkr, receivedOn: r.receivedOn, nextDueOn: r.nextDueOn || null, note: r.note })), totalValueLkr: list.reduce((a, r) => a + (r.valueLkr || 0), 0) });
}
async function deleteSubsidy(req, res) {
  if (!validId(req.params.id)) return fail(res, 400, "Invalid id.");
  const r = await SubsidyRecord.deleteOne({ _id: req.params.id, farmer: req.userId });
  return r.deletedCount ? res.status(200).json({ success: true }) : fail(res, 404, "Not found.");
}

// ---------------- government support prices (typed by the admin from the official notice) ----------------
async function listSupportPrices(req, res) {
  const rows = await SupportPrice.find({ isActive: true }).sort({ effectiveFrom: -1 }).lean();
  const seen = new Set(), latest = [];
  for (const r of rows) if (!seen.has(r.cropType + r.label)) { seen.add(r.cropType + r.label); latest.push({ id: String(r._id), cropType: r.cropType, label: r.label, pricePerKg: r.pricePerKg, source: r.source, effectiveFrom: r.effectiveFrom }); }
  return res.status(200).json({ success: true, data: latest });
}
async function publishSupportPrice(req, res) {
  const b = req.body || {}; const crop = canonicalCrop(b.cropType); const price = num(b.pricePerKg);
  if (!crop || !(price >= 1 && price <= 5000)) return fail(res, 400, "Choose a crop and a price between 1 and 5,000.");
  const r = await SupportPrice.create({ cropType: crop, label: cleanText(b.label || "", 60), pricePerKg: price, source: cleanText(b.source || "", 120), effectiveFrom: b.effectiveFrom ? new Date(b.effectiveFrom) : new Date() });
  return res.status(201).json({ success: true, data: { id: String(r._id) } });
}
async function removeSupportPrice(req, res) {
  if (!validId(req.params.id)) return fail(res, 400, "Invalid id.");
  await SupportPrice.updateOne({ _id: req.params.id }, { $set: { isActive: false } });
  return res.status(200).json({ success: true });
}

// ---------------- is my price sensible? ----------------
/** POST /api/records/price-check { cropType, pricePerKg } — compares with the official prices of the last 7 days. */
async function priceCheck(req, res) {
  const crop = canonicalCrop((req.body || {}).cropType); const price = num((req.body || {}).pricePerKg);
  if (!crop || !(price > 0)) return fail(res, 400, "Choose a crop and a price.");
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const rows = await MarketPrice.find({ cropType: crop, verified: true, day: { $gte: since } }).select("pricePerKg").lean();
  if (rows.length < 2) return res.status(200).json({ success: true, data: { verdict: "unknown", referencePerKg: null } });
  const ref = median(rows.map((r) => r.pricePerKg));
  const verdict = price > ref * 2.5 ? "high" : price < ref * 0.4 ? "low" : "ok";
  return res.status(200).json({ success: true, data: { verdict, referencePerKg: Math.round(ref), ratio: Math.round((price / ref) * 100) / 100 } });
}

// ---------------- damage reports (evidence for an insurer / officer) ----------------
async function addDamage(req, res) {
  try {
    const b = req.body || {};
    const crop = canonicalCrop(b.cropType);
    if (!crop) return fail(res, 400, "Unknown crop.");
    if (!["drought", "flood", "heavy_rain", "pest", "disease", "wildlife", "fire", "other"].includes(b.cause)) return fail(res, 400, "Choose the cause.");
    const acres = num(b.acresAffected); const happened = new Date(b.happenedOn || Date.now());
    if (!(acres > 0 && acres <= 10000)) return fail(res, 400, "Enter the affected area in acres.");
    if (isNaN(happened) || happened.getTime() > Date.now() + 86400000 || happened.getTime() < Date.now() - 2 * 365 * 86400000) return fail(res, 400, "That date doesn't look right.");
    const photos = Array.isArray(b.photos) ? b.photos.slice(0, 3) : [];
    const decoded = [];
    for (const p of photos) { const img = decodeImage(p); if (img.error) return fail(res, img.status || 400, img.error); decoded.push(img); }
    const report = await DamageReport.create({ farmer: req.userId, cropType: crop, cause: b.cause, acresAffected: acres, estimatedLossLkr: Math.max(0, Math.round(num(b.estimatedLossLkr) || 0)), happenedOn: happened, description: cleanText(b.description || "", 400), photoCount: decoded.length });
    for (const img of decoded) await Photo.create({ owner: req.userId, purpose: "damage", refId: report._id, mime: img.mime, data: img.bytes, size: img.bytes.length });
    return res.status(201).json({ success: true, data: { id: String(report._id) } });
  } catch (error) { console.error("addDamage error:", error); return fail(res, 500, "Failed to save the report."); }
}
async function listDamage(req, res) {
  const list = await DamageReport.find({ farmer: req.userId }).sort({ happenedOn: -1 }).limit(50).lean();
  const photos = await Photo.find({ purpose: "damage", refId: { $in: list.map((r) => r._id) } }).select("refId").lean();
  const byReport = {}; photos.forEach((p) => { (byReport[String(p.refId)] = byReport[String(p.refId)] || []).push(String(p._id)); });
  return res.status(200).json({ success: true, data: list.map((r) => ({ id: String(r._id), cropType: r.cropType, cause: r.cause, acresAffected: r.acresAffected, estimatedLossLkr: r.estimatedLossLkr, happenedOn: r.happenedOn, description: r.description, photoIds: byReport[String(r._id)] || [] })) });
}

// ---------------- rain planner ----------------
async function rainPlanner(req, res) {
  try {
    if (req.query.district && !canonicalDistrict(req.query.district)) return fail(res, 400, "Unknown district.");
    let district = req.query.district ? canonicalDistrict(req.query.district) : null;
    if (!district) { const me = await User.findById(req.userId).select("farmerProfile.district"); district = canonicalDistrict(me && me.farmerProfile ? me.farmerProfile.district : ""); }
    if (!district) return fail(res, 400, "Choose a district (or set yours in Profile → Edit).", "no_district");
    let rain;
    try { rain = await monthlyRainfall(district); } catch (error) { return fail(res, 503, "The rainfall service could not be reached. Please try again later.", "rain_unavailable"); }
    return res.status(200).json({ success: true, data: { district, months: MONTHS.map((m, i) => ({ month: m, mm: rain.monthlyMm[i] })), years: rain.years, advice: plantingAdvice(rain.monthlyMm), note: "Based on the average rain of past years — not a forecast. Also follow your Agrarian Service Centre's advice and your irrigation schedule." } });
  } catch (error) { console.error("rainPlanner error:", error); return fail(res, 500, "Failed to build the planner."); }
}

// ---------------- printable reports (signed, expiring links; open in any browser, "Save as PDF") ----------------
const secret = () => process.env.REPORT_LINK_SECRET || process.env.JWT_SECRET || "agrilink-reports";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lkr = (n) => "LKR " + Math.round(n || 0).toLocaleString("en-US");
const baseUrl = (req) => `${req.headers["x-forwarded-proto"] || req.protocol}://${req.get("host")}`;
const PAGE_CSS = "body{font-family:system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#1f2937;line-height:1.5}h1{color:#0b5d3b;margin-bottom:0}h2{border-bottom:2px solid #d1fae5;padding-bottom:4px;margin-top:26px}table{width:100%;border-collapse:collapse}td,th{padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:left;font-size:14px}.r{text-align:right}.note{background:#fffbeb;border:1px solid #fde68a;padding:10px 12px;border-radius:8px;font-size:13px;margin-top:22px}.big{font-size:22px;font-weight:700}@media print{.noprint{display:none}}";

async function reportLink(req, res) {
  const kind = req.params.kind;
  if (!["loan", "damage"].includes(kind)) return fail(res, 404, "Unknown report.");
  let subject = String(req.userId);
  if (kind === "damage") { if (!validId((req.body || {}).damageId) || !(await DamageReport.exists({ _id: req.body.damageId, farmer: req.userId }))) return fail(res, 404, "Damage report not found."); subject = String(req.body.damageId); }
  const token = jwt.sign({ purpose: kind + "_report", sub: subject, farmer: String(req.userId) }, secret(), { expiresIn: "48h" });
  return res.status(200).json({ success: true, url: `${baseUrl(req)}/api/records/report/${kind}?t=${token}`, expiresInHours: 48 });
}

async function loanReportHtml(farmerId) {
  const user = await User.findById(farmerId).lean();
  if (!user) return null;
  const since = new Date(Date.now() - 365 * 86400000);
  const [ledger, yields, orders, damage, trust] = await Promise.all([LedgerEntry.find({ farmer: farmerId, date: { $gte: since } }).lean(), YieldRecord.find({ farmer: farmerId }).sort({ year: -1 }).limit(8).lean(), TradeOrder.find({ farmer: farmerId, status: "paid" }).lean(), DamageReport.countDocuments({ farmer: farmerId }), computeTrust([farmerId])]);
  let income = 0, cost = 0; const byCrop = {};
  ledger.forEach((e) => { const c = (byCrop[e.cropType] = byCrop[e.cropType] || { income: 0, cost: 0 }); if (e.type === "income") { income += e.amountLkr; c.income += e.amountLkr; } else { cost += e.amountLkr; c.cost += e.amountLkr; } });
  const t = trust[String(farmerId)]; const f = user.farmerProfile || {};
  const rows = Object.entries(byCrop).map(([crop, c]) => `<tr><td>${esc(crop)}</td><td class="r">${lkr(c.income)}</td><td class="r">${lkr(c.cost)}</td><td class="r">${lkr(c.income - c.cost)}</td></tr>`).join("");
  const yrows = yields.map((y) => `<tr><td>${esc(y.cropType)}</td><td>${esc(y.season)} ${y.year}</td><td class="r">${y.acres} ac</td><td class="r">${y.harvestKg.toLocaleString("en-US")} kg</td><td class="r">${Math.round(y.harvestKg / y.acres)} kg/ac</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Farm finance summary — ${esc(user.fullName)}</title><style>${PAGE_CSS}</style></head><body>
<button class="noprint" onclick="print()">Print / Save as PDF</button>
<h1>Farm finance summary</h1><p>${esc(user.fullName)} · ${esc(f.district || "")} · ${f.landSizeAcres ? f.landSizeAcres + " acres" : "land size not given"} · generated ${new Date().toISOString().slice(0, 10)}</p>
<h2>Standing</h2><table><tr><td>AgriLink credit score</td><td class="r"><b>${f.creditScore ?? "—"}</b> / 1000</td></tr><tr><td>Completed crop cycles</td><td class="r">${f.completedTimelinesCount ?? 0}</td></tr><tr><td>Identity check</td><td class="r">${user.verification && user.verification.status === "verified" ? "Verified by AgriLink" : "Not verified"}</td></tr><tr><td>Buyer ratings</td><td class="r">${t && t.ratingCount ? t.average + " ★ from " + t.ratingCount : "none yet"}</td></tr><tr><td>Sales completed through AgriLink</td><td class="r">${orders.length} (${lkr(orders.reduce((a, o) => a + o.totalLkr, 0))})</td></tr><tr><td>Crop damage events recorded</td><td class="r">${damage}</td></tr></table>
<h2>Last 12 months (from the farmer's own ledger)</h2><p class="big">Income ${lkr(income)} · Costs ${lkr(cost)} · <span style="color:${income - cost >= 0 ? "#0b5d3b" : "#b91c1c"}">${income - cost >= 0 ? "Profit" : "Loss"} ${lkr(Math.abs(income - cost))}</span></p>
${rows ? `<table><tr><th>Crop</th><th class="r">Income</th><th class="r">Costs</th><th class="r">Profit</th></tr>${rows}</table>` : "<p>No ledger entries yet.</p>"}
<h2>Harvest records</h2>${yrows ? `<table><tr><th>Crop</th><th>Season</th><th class="r">Land</th><th class="r">Harvest</th><th class="r">Yield</th></tr>${yrows}</table>` : "<p>No harvest records yet.</p>"}
<div class="note"><b>Please read:</b> figures in the ledger and harvest records are entered by the farmer and are <b>not audited</b>. Sales, ratings and the identity check come from AgriLink's own records. This summary supports a conversation with a lender; it is not a guarantee of repayment or a credit rating by a bank. This link expires 48 hours after it was created.</div></body></html>`;
}

async function damageReportHtml(damageId) {
  const d = await DamageReport.findById(damageId).lean(); if (!d) return null;
  const [user, photos] = await Promise.all([User.findById(d.farmer).select("fullName phone farmerProfile.district").lean(), Photo.find({ purpose: "damage", refId: d._id }).lean()]);
  const imgs = photos.map((p) => `<img style="max-width:100%;margin:6px 0;border-radius:8px" src="data:${p.mime};base64,${p.data.toString("base64")}">`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Crop damage report</title><style>${PAGE_CSS}</style></head><body><button class="noprint" onclick="print()">Print / Save as PDF</button>
<h1>Crop damage report</h1><p>${esc(user.fullName)} · ${esc(user.farmerProfile && user.farmerProfile.district)} · phone ${esc(user.phone)}</p>
<table><tr><td>Crop</td><td>${esc(d.cropType)}</td></tr><tr><td>Cause</td><td>${esc(d.cause.replace("_", " "))}</td></tr><tr><td>Date it happened</td><td>${d.happenedOn.toISOString().slice(0, 10)}</td></tr><tr><td>Area affected</td><td>${d.acresAffected} acres</td></tr><tr><td>Estimated loss (farmer's estimate)</td><td>${lkr(d.estimatedLossLkr)}</td></tr></table>
${d.description ? `<h2>What happened</h2><p>${esc(d.description)}</p>` : ""}${imgs ? `<h2>Photos</h2>${imgs}` : ""}
<div class="note">Recorded by the farmer in the AgriLink app on ${d.createdAt.toISOString().slice(0, 10)}. The loss figure is the farmer's own estimate and has not been checked by AgriLink. It is meant to help a claim or a visit by an officer, not to replace one. This link expires 48 hours after it was created.</div></body></html>`;
}

async function viewReport(req, res) {
  try {
    const kind = req.params.kind;
    let claims;
    try { claims = jwt.verify(String(req.query.t || ""), secret()); } catch (_) { return res.status(410).type("html").send("<h2>This link has expired or is not valid.</h2><p>Open the AgriLink app and create a new link.</p>"); }
    if (claims.purpose !== kind + "_report") return res.status(403).type("html").send("<h2>Not allowed.</h2>");
    const html = kind === "loan" ? await loanReportHtml(claims.sub) : await damageReportHtml(claims.sub);
    if (!html) return res.status(404).type("html").send("<h2>Report not found.</h2>");
    res.set("Cache-Control", "no-store"); res.set("X-Robots-Tag", "noindex");
    return res.status(200).type("html").send(html);
  } catch (error) { console.error("viewReport error:", error); return res.status(500).type("html").send("<h2>Something went wrong.</h2>"); }
}

module.exports = { addYield, listYields, deleteYield, addSubsidy, listSubsidies, deleteSubsidy, listSupportPrices, publishSupportPrice, removeSupportPrice, priceCheck, addDamage, listDamage, rainPlanner, reportLink, viewReport };
