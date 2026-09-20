const mongoose = require("mongoose");
const LedgerEntry = require("../models/LedgerEntry");
const { canonicalCrop } = require("../utils/chatConfig");

const CATEGORIES = ["seeds", "fertilizer", "pesticide", "labour", "water", "transport", "equipment", "other", "sale"];

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function shape(e) {
  return { id: String(e._id), cropType: e.cropType, type: e.type, category: e.category, amountLkr: e.amountLkr, note: e.note, date: e.date, fromOrder: Boolean(e.orderRef) };
}

/** POST /api/ledger { type, category, amountLkr, cropType?, note?, date? } */
async function addEntry(req, res) {
  try {
    const b = req.body || {};
    if (!["expense", "income"].includes(b.type)) return fail(res, 400, "Choose expense or income.");
    const amount = Number(b.amountLkr);
    if (!Number.isFinite(amount) || amount < 1 || amount > 100000000) return fail(res, 400, "Enter an amount between 1 and 100,000,000.");
    const category = b.type === "income" ? "sale" : (CATEGORIES.includes(b.category) && b.category !== "sale" ? b.category : "other");
    const date = b.date ? new Date(b.date) : new Date();
    if (isNaN(date) || date.getTime() > Date.now() + 86400000 || date.getTime() < Date.now() - 3 * 365 * 86400000) return fail(res, 400, "That date doesn't look right.");
    const crop = b.cropType && b.cropType !== "General" ? canonicalCrop(b.cropType) : null;
    if (b.cropType && b.cropType !== "General" && !crop) return fail(res, 400, "Unknown crop.");
    const entry = await LedgerEntry.create({ farmer: req.userId, cropType: crop || "General", type: b.type, category, amountLkr: Math.round(amount), note: String(b.note || "").trim().slice(0, 120), date });
    return res.status(201).json({ success: true, data: shape(entry) });
  } catch (error) {
    console.error("addEntry error:", error);
    return fail(res, 500, "Failed to save the entry.");
  }
}

/** GET /api/ledger?cropType= — newest first. */
async function listEntries(req, res) {
  try {
    const filter = { farmer: req.userId };
    if (req.query.cropType) filter.cropType = req.query.cropType;
    const entries = await LedgerEntry.find(filter).sort({ date: -1, _id: -1 }).limit(200);
    return res.status(200).json({ success: true, data: entries.map(shape) });
  } catch (error) {
    console.error("listEntries error:", error);
    return fail(res, 500, "Failed to load entries.");
  }
}

async function deleteEntry(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 400, "Invalid entry.");
    const result = await LedgerEntry.deleteOne({ _id: req.params.id, farmer: req.userId });
    if (!result.deletedCount) return fail(res, 404, "Entry not found.");
    return res.status(200).json({ success: true });
  } catch (error) {
    return fail(res, 500, "Failed to delete.");
  }
}

/** GET /api/ledger/summary — totals, profit, spending by category, each crop, and the last 6 months. */
async function summary(req, res) {
  try {
    const entries = await LedgerEntry.find({ farmer: req.userId }).lean();
    let income = 0, expense = 0;
    const byCategory = {}, byCrop = {}, byMonth = {};
    for (const e of entries) {
      const isIncome = e.type === "income";
      if (isIncome) income += e.amountLkr; else { expense += e.amountLkr; byCategory[e.category] = (byCategory[e.category] || 0) + e.amountLkr; }
      const c = (byCrop[e.cropType] = byCrop[e.cropType] || { cropType: e.cropType, income: 0, expense: 0 });
      c[isIncome ? "income" : "expense"] += e.amountLkr;
      const month = new Date(e.date).toISOString().slice(0, 7);
      const m = (byMonth[month] = byMonth[month] || { month, income: 0, expense: 0 });
      m[isIncome ? "income" : "expense"] += e.amountLkr;
    }
    const crops = Object.values(byCrop).map((c) => ({ ...c, profit: c.income - c.expense })).sort((a, b) => b.profit - a.profit);
    const months = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
    return res.status(200).json({ success: true, data: { income, expense, profit: income - expense, entries: entries.length, byCategory, crops, months } });
  } catch (error) {
    console.error("summary error:", error);
    return fail(res, 500, "Failed to build the summary.");
  }
}

module.exports = { addEntry, listEntries, deleteEntry, summary, CATEGORIES };
