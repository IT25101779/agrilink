const crypto = require("crypto");
const User = require("../models/User");
const MarketplaceListing = require("../models/MarketplaceListing");
const CultivationTimeline = require("../models/CultivationTimeline");
const CrowdfundingCampaign = require("../models/CrowdfundingCampaign");
const GroupLot = require("../models/GroupLot");

/**
 * FARM PASSPORT
 *
 * A one-page, shareable track record for a farmer, built from what AgriLink
 * has actually recorded: completed crops, sales, funding repaid and group
 * sales. Its purpose is financial inclusion — a smallholder with no bank
 * history can still show an investor or lender what they have delivered.
 *
 * HONESTY NOTE (also printed on the passport itself): crop timelines are
 * entered by the farmer and are not audited. Sales, funding and repayment
 * records are created by activity on the AgriLink platform.
 */

function round2(n) {
  return Math.round(n * 100) / 100;
}

function creditBand(score) {
  if (score >= 800) return "Excellent";
  if (score >= 600) return "Good";
  return "Building";
}

/** A short, stable label for this passport (not secret, not a password). */
function passportLabel(userId) {
  const digest = crypto
    .createHmac("sha256", process.env.JWT_SECRET || "agrilink")
    .update(String(userId))
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  return `AL-${digest}`;
}

/**
 * LOAN READINESS: an 8-point checklist of the things a lender or investor
 * typically likes to see, with how far along the farmer is on each.
 *
 * It is AgriLink's own checklist to guide farmers — NOT a bank's criteria
 * and not a credit decision. The thresholds are easy to tune here.
 */
function buildReadiness({ stats, creditScore, memberSince, now = new Date() }) {
  const memberDays = Math.floor((now.getTime() - new Date(memberSince).getTime()) / (24 * 60 * 60 * 1000));
  const check = (id, label, met, current, target, tip) => ({ id, label, met, current, target, tip });

  const checks = [
    check("cycles", "Complete 2 crop cycles", stats.completedTimelines >= 2, stats.completedTimelines, 2,
      "Finish a crop timeline (or repay a funded campaign) to add a completed cycle."),
    check("sales", "Make 5 completed sales", stats.salesCompleted >= 5, stats.salesCompleted, 5,
      "List produce on the marketplace and mark orders as sold."),
    check("volume", "Reach LKR 100,000 in total sales", stats.salesValueLkr >= 100000, Math.round(stats.salesValueLkr), 100000,
      "Sell more produce, or join Group Lots to reach bulk buyers."),
    check("quality", "Keep buyer rejections at 20% or less", stats.salesCompleted > 0 && stats.buyerRejectionRatePercent <= 20,
      stats.buyerRejectionRatePercent, 20, "Grade and pack produce carefully; sell while it is still fresh."),
    check("repayment", "Repay one funding campaign", stats.fundingRepaidCampaigns >= 1, stats.fundingRepaidCampaigns, 1,
      "Ask investors to fund a crop, then repay after harvest."),
    check("score", "Reach a credit score of 600", creditScore >= 600, creditScore, 600,
      "The score grows with completed cycles and repaid funding."),
    check("community", "Complete one group sale", stats.groupSalesCompleted >= 1, stats.groupSalesCompleted, 1,
      "Join a Group Lot in the Market tab and wait for a buyer to claim it."),
    check("history", "Be active for 60 days", memberDays >= 60, Math.max(0, memberDays), 60,
      "A longer record builds trust; keep using AgriLink."),
  ];

  const passed = checks.filter((c) => c.met).length;
  const percent = Math.round((passed / checks.length) * 100);
  const level = percent >= 75 ? "loan_ready" : percent >= 50 ? "almost_ready" : "getting_started";
  return { percent, level, passed, total: checks.length, checks };
}

async function buildPassport(userId) {
  const user = await User.findById(userId).select("fullName createdAt role farmerProfile").lean();
  if (!user) return null;

  const [listings, timelines, campaigns, lots] = await Promise.all([
    MarketplaceListing.find({ farmer: userId }).select("cropType status quantityKg currentPricePerKg agreedPricePerKg rejectionHistory").lean(),
    CultivationTimeline.find({ farmer: userId }).select("status cropType").lean(),
    CrowdfundingCampaign.find({ farmer: userId }).select("status amountRaisedLkr pledges").lean(),
    GroupLot.find({ "members.farmer": userId, status: "claimed" }).select("members").lean(),
  ]);

  const profile = user.farmerProfile || {};
  const creditScore = Number(profile.creditScore) || 500;

  const sold = listings.filter((l) => l.status === "sold");
  const soldKg = sold.reduce((sum, l) => sum + l.quantityKg, 0);
  const salesValueLkr = round2(sold.reduce((sum, l) => sum + l.quantityKg * (l.agreedPricePerKg || l.currentPricePerKg), 0));
  const rejected = listings.filter((l) => (l.rejectionHistory || []).length > 0).length;
  const cropsSold = [...new Set(sold.map((l) => l.cropType))];

  const completedFromTimelines = timelines.filter((t) => t.status === "completed").length;
  const activeTimelines = timelines.filter((t) => t.status === "active").length;
  const completedTimelines = Math.max(completedFromTimelines, Number(profile.completedTimelinesCount) || 0);

  const fundedOrRepaid = campaigns.filter((c) => ["funded", "repaid"].includes(c.status));
  const repaid = campaigns.filter((c) => c.status === "repaid");
  const totalRaisedLkr = round2(fundedOrRepaid.reduce((sum, c) => sum + c.amountRaisedLkr, 0));
  const totalRepaidLkr = round2(repaid.reduce((sum, c) => sum + (c.pledges || []).reduce((s, p) => s + p.expectedReturnLkr, 0), 0));
  const investors = new Set();
  fundedOrRepaid.forEach((c) => (c.pledges || []).forEach((p) => investors.add(String(p.investor))));

  const groupKg = lots.reduce((sum, lot) => {
    const mine = (lot.members || []).find((m) => String(m.farmer) === String(userId));
    return sum + (mine ? mine.quantityKg : 0);
  }, 0);

  const passportStats = {
    completedTimelines,
    activeTimelines,
    salesCompleted: sold.length,
    kgSold: round2(soldKg),
    salesValueLkr,
    cropsSold,
    buyerRejectionRatePercent: listings.length ? Math.round((rejected / listings.length) * 100) : 0,
    fundingCampaignsFunded: fundedOrRepaid.length,
    fundingRaisedLkr: totalRaisedLkr,
    fundingRepaidCampaigns: repaid.length,
    fundingRepaidLkr: totalRepaidLkr,
    investorsBacked: investors.size,
    groupSalesCompleted: lots.length,
    groupKgContributed: round2(groupKg),
  };

  return {
    passportId: passportLabel(userId),
    name: user.fullName,
    district: profile.district || "",
    memberSince: user.createdAt,
    creditScore,
    creditBand: creditBand(creditScore),
    stats: passportStats,
    readiness: buildReadiness({ stats: passportStats, creditScore, memberSince: user.createdAt }),
    generatedAt: new Date().toISOString(),
  };
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function lkr(n) {
  return "LKR " + Math.round(n).toLocaleString("en-US");
}

/** The public web page a lender or investor sees after scanning the QR code. */
function readinessLabel(level) {
  return level === "loan_ready" ? "Loan-ready" : level === "almost_ready" ? "Almost ready" : "Getting started";
}

function renderPassportHtml(p, { qrUrl } = {}) {
  const s = p.stats;
  const r = p.readiness;
  const scorePct = Math.max(0, Math.min(100, Math.round(((p.creditScore - 300) / 700) * 100)));
  const memberSince = new Date(p.memberSince).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const bandColor = p.creditBand === "Excellent" ? "#0B5D3B" : p.creditBand === "Good" ? "#2E7D32" : "#B7791F";

  const tile = (value, label) => `<div class="tile"><div class="v">${escapeHtml(value)}</div><div class="l">${escapeHtml(label)}</div></div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Farm Passport — ${escapeHtml(p.name)}</title>
<style>
  :root { --forest:#0B5D3B; --forest-dark:#073D27; --tint:#EFF7F1; --ink:#1F2A24; --muted:#6C7B72; --border:#E1E9E3; --gold:#E0A72E; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background:#F7F9F6; color:var(--ink); }
  .wrap { max-width: 560px; margin: 0 auto; padding: 16px; }
  .card { background:#fff; border:1px solid var(--border); border-radius:18px; overflow:hidden; box-shadow:0 6px 24px rgba(11,93,59,.08); }
  .head { background: linear-gradient(135deg, var(--forest-dark), var(--forest)); color:#fff; padding:22px 22px 26px; }
  .brand { font-size:12px; letter-spacing:.14em; text-transform:uppercase; opacity:.8; }
  h1 { margin:8px 0 2px; font-size:24px; }
  .sub { opacity:.85; font-size:14px; }
  .pid { display:inline-block; margin-top:12px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size:12px; background:rgba(255,255,255,.14); padding:4px 10px; border-radius:99px; }
  .body { padding: 20px 22px 24px; }
  .score { display:flex; align-items:center; gap:14px; }
  .score .n { font-size:40px; font-weight:800; color:${bandColor}; line-height:1; }
  .score .b { font-weight:700; color:${bandColor}; }
  .bar { height:10px; background:var(--tint); border-radius:99px; overflow:hidden; margin:10px 0 4px; }
  .bar > div { height:100%; width:${scorePct}%; background:${bandColor}; border-radius:99px; }
  .scale { display:flex; justify-content:space-between; font-size:11px; color:var(--muted); }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:24px 0 10px; }
  .grid { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
  .tile { background:var(--tint); border-radius:12px; padding:14px; }
  .tile .v { font-size:20px; font-weight:800; color:var(--forest); }
  .tile .l { font-size:12px; color:var(--muted); margin-top:2px; }
  .crops { font-size:14px; color:var(--ink); }
  .note { margin-top:22px; font-size:12px; color:var(--muted); background:#FFF9EC; border:1px solid #F3E2B5; padding:12px 14px; border-radius:12px; line-height:1.5; }
  .foot { text-align:center; font-size:11px; color:var(--muted); margin:16px 0 4px; }
  .checks { list-style:none; padding:0; margin:12px 0 0; }
  .checks li { padding:7px 0; border-bottom:1px solid var(--border); font-size:14px; color:var(--muted); }
  .checks li.met { color:var(--ink); }
  .checks .mark { display:inline-block; width:20px; color:var(--muted); }
  .checks li.met .mark { color:var(--forest); font-weight:800; }
  .qr { text-align:center; margin-top:18px; }
  .qr img { width:120px; height:120px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="head">
      <div class="brand">AgriLink AI &middot; Farm Passport</div>
      <h1>${escapeHtml(p.name)}</h1>
      <div class="sub">${escapeHtml(p.district || "Sri Lanka")} &middot; Member since ${escapeHtml(memberSince)}</div>
      <div class="pid">${escapeHtml(p.passportId)}</div>
    </div>
    <div class="body">
      <div class="score">
        <div class="n">${escapeHtml(p.creditScore)}</div>
        <div><div class="b">${escapeHtml(p.creditBand)}</div><div style="font-size:12px;color:var(--muted)">AgriLink alternative credit score</div></div>
      </div>
      <div class="bar"><div></div></div>
      <div class="scale"><span>300</span><span>1000</span></div>

      <h2>Farming record</h2>
      <div class="grid">
        ${tile(s.completedTimelines, "Crop cycles completed")}
        ${tile(s.activeTimelines, "Crops growing now")}
      </div>

      <h2>Sales on AgriLink</h2>
      <div class="grid">
        ${tile(s.salesCompleted, "Completed sales")}
        ${tile(s.kgSold.toLocaleString("en-US") + " kg", "Produce sold")}
        ${tile(lkr(s.salesValueLkr), "Total sales value")}
        ${tile(s.buyerRejectionRatePercent + "%", "Listings rejected by buyers")}
      </div>
      ${s.cropsSold.length ? `<p class="crops"><strong>Crops sold:</strong> ${escapeHtml(s.cropsSold.join(", "))}</p>` : ""}

      <h2>Funding &amp; repayment</h2>
      <div class="grid">
        ${tile(s.fundingCampaignsFunded, "Campaigns fully funded")}
        ${tile(lkr(s.fundingRaisedLkr), "Raised from investors")}
        ${tile(s.fundingRepaidCampaigns, "Campaigns repaid")}
        ${tile(lkr(s.fundingRepaidLkr), "Repaid to investors")}
      </div>

      <h2>Community</h2>
      <div class="grid">
        ${tile(s.groupSalesCompleted, "Group sales completed")}
        ${tile(s.groupKgContributed.toLocaleString("en-US") + " kg", "Contributed to group lots")}
      </div>

      <h2>Loan readiness &middot; ${escapeHtml(r.passed)} of ${escapeHtml(r.total)} checks</h2>
      <div class="bar"><div style="width:${escapeHtml(r.percent)}%"></div></div>
      <div class="scale"><span>${escapeHtml(readinessLabel(r.level))}</span><span>${escapeHtml(r.percent)}%</span></div>
      <ul class="checks">
        ${r.checks.map((c) => `<li class="${c.met ? "met" : ""}"><span class="mark">${c.met ? "&#10003;" : "&#9675;"}</span> ${escapeHtml(c.label)}</li>`).join("")}
      </ul>

      ${qrUrl ? `<div class="qr"><img src="${escapeHtml(qrUrl)}" alt="QR code for this passport"></div>` : ""}

      <div class="note">
        <strong>How to read this passport.</strong> Sales, funding and repayment figures are recorded from activity on the AgriLink platform. Crop timelines are entered by the farmer and are not independently audited. This passport is a supporting record, not a guarantee, and does not replace a lender's own checks.
      </div>
    </div>
  </div>
  <div class="foot">Generated live ${escapeHtml(new Date(p.generatedAt).toUTCString())} &middot; AgriLink AI</div>
</div>
</body>
</html>`;
}

module.exports = { buildPassport, buildReadiness, renderPassportHtml, creditBand, passportLabel, escapeHtml };
