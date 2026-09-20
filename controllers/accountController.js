const crypto = require("crypto");
const User = require("../models/User");
const TradeOrder = require("../models/TradeOrder");
const MarketplaceListing = require("../models/MarketplaceListing");
const LedgerEntry = require("../models/LedgerEntry");
const YieldRecord = require("../models/YieldRecord");
const SubsidyRecord = require("../models/SubsidyRecord");
const DamageReport = require("../models/DamageReport");
const Question = require("../models/Question");
const Feedback = require("../models/Feedback");
const Reminder = require("../models/Reminder");
const PriceAlert = require("../models/PriceAlert");
const SurveyResponse = require("../models/SurveyResponse");
const ProfileImage = require("../models/ProfileImage");
const Photo = require("../models/Photo");
const PaymentProfile = require("../models/PaymentProfile");
const DeviceToken = require("../models/DeviceToken");
const Rating = require("../models/Rating");
const GroupMembership = require("../models/GroupMembership");
const GroupMessage = require("../models/GroupMessage");
const ChatMessage = require("../models/ChatMessage");
const ChatMedia = require("../models/ChatMedia");
const Block = require("../models/Block");

const PRIVACY_VERSION = "2026-09";
const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
async function ensureReferralCode(user) {
  if (user.referralCode) return user.referralCode;
  for (let i = 0; i < 8; i++) {
    const code = Array.from({ length: 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join("");
    if (!(await User.exists({ referralCode: code }))) {
      await User.updateOne({ _id: user._id }, { $set: { referralCode: code } });
      user.referralCode = code;
      return code;
    }
  }
  return "";
}

/** POST /api/auth/consent { version } — the person accepted the privacy notice. */
async function consent(req, res) {
  await User.updateOne({ _id: req.userId }, { $set: { consentAcceptedAt: new Date(), consentVersion: String((req.body || {}).version || PRIVACY_VERSION).slice(0, 20) } });
  return res.status(200).json({ success: true, version: PRIVACY_VERSION });
}

/** GET /api/auth/export — everything AgriLink holds about ME, as a file. */
async function exportData(req, res) {
  try {
    const id = req.userId;
    const user = await User.findById(id).lean();
    delete user.passwordHash; delete user.resetPasswordOtpHash; delete user.resetPasswordExpires;
    const [orders, listings, ledger, yields, subsidies, damage, questions, feedback, ratingsGiven, ratingsReceived, surveys, alerts] = await Promise.all([
      TradeOrder.find({ $or: [{ farmer: id }, { buyer: id }] }).select("-delivery.codeSalt").lean(),
      MarketplaceListing.find({ farmer: id }).lean(), LedgerEntry.find({ farmer: id }).lean(), YieldRecord.find({ farmer: id }).lean(), SubsidyRecord.find({ farmer: id }).lean(),
      DamageReport.find({ farmer: id }).lean(), Question.find({ farmer: id }).lean(), Feedback.find({ user: id }).lean(),
      Rating.find({ rater: id }).lean(), Rating.find({ ratee: id }).lean(), SurveyResponse.find({ respondent: id }).lean(), PriceAlert.find({ farmer: id }).lean(),
    ]);
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Content-Disposition", 'attachment; filename="my-agrilink-data.json"');
    return res.status(200).send(JSON.stringify({ exportedAt: new Date(), privacyNoticeVersion: PRIVACY_VERSION, account: user, orders, listings, ledger, yields, subsidies, damageReports: damage, questions, feedback, ratingsGiven, ratingsReceived, surveyAnswers: surveys, priceAlerts: alerts, note: "Photos are not included in this file. Chat messages are anonymous and not linked to your name." }, null, 2));
  } catch (error) {
    console.error("exportData error:", error);
    return fail(res, 500, "Could not prepare your data.");
  }
}

/**
 * POST /api/auth/delete-account { password }
 * Removes your personal details and private records. Orders and ratings stay (with your name replaced by
 * "Deleted user") because the other person in the deal still needs their record. Refused while a deal is unfinished.
 */
async function deleteAccount(req, res) {
  try {
    const user = await User.findById(req.userId);
    if (!user) return fail(res, 404, "Account not found.");
    if (user.role === "admin") return fail(res, 403, "Admin accounts must be removed by another admin.");
    if (typeof (req.body || {}).password !== "string" || !(await user.comparePassword(req.body.password))) return fail(res, 401, "Your password is incorrect.");
    const id = user._id;
    const unfinished = await TradeOrder.countDocuments({ $or: [{ farmer: id }, { buyer: id }], status: { $in: ["placed", "accepted", "dispatched", "delivered"] } });
    if (unfinished > 0) return fail(res, 409, "You still have an unfinished order. Please finish or cancel it first.", "unfinished_orders");

    await Promise.all([
      MarketplaceListing.deleteMany({ farmer: id, status: { $in: ["listed", "expired", "redirected"] } }), LedgerEntry.deleteMany({ farmer: id }), YieldRecord.deleteMany({ farmer: id }),
      SubsidyRecord.deleteMany({ farmer: id }), DamageReport.deleteMany({ farmer: id }), Question.deleteMany({ farmer: id }), Feedback.deleteMany({ user: id }), Reminder.deleteMany({ farmer: id }),
      PriceAlert.deleteMany({ farmer: id }), SurveyResponse.deleteMany({ respondent: id }), ProfileImage.deleteMany({ user: id }), Photo.deleteMany({ owner: id }), PaymentProfile.deleteMany({ user: id }),
      DeviceToken.deleteMany({ user: id }), GroupMembership.deleteMany({ user: id }), GroupMessage.deleteMany({ sender: id }), ChatMessage.deleteMany({ farmer: id }), ChatMedia.deleteMany({ uploader: id }), Block.deleteMany({ $or: [{ blocker: id }, { blocked: id }] }),
    ]);
    await User.updateOne({ _id: id }, { $set: { fullName: "Deleted user", email: `deleted-${id}@deleted.invalid`, phone: "", passwordHash: crypto.randomBytes(32).toString("hex"), isActive: false, smsAlerts: false }, $unset: { farmerProfile: 1, buyerProfile: 1, driverProfile: 1, avatarUpdatedAt: 1, referralCode: 1, officerProfile: 1 } });
    return res.status(200).json({ success: true, message: "Your account and personal records were deleted." });
  } catch (error) {
    console.error("deleteAccount error:", error);
    return fail(res, 500, "Could not delete the account.");
  }
}

/** GET /api/legal/privacy — public page in English, Sinhala and Tamil. Edit PRIVACY_CONTACT to your real email. */
function privacyPage(req, res) {
  const contact = process.env.PRIVACY_CONTACT || "the AgriLink team";
  const block = (title, en, si, ta) => `<h2>${title}</h2><p>${en}</p><p lang="si">${si}</p><p lang="ta">${ta}</p>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgriLink privacy notice</title>
<style>body{font-family:system-ui,'Noto Sans Sinhala','Noto Sans Tamil',sans-serif;max-width:720px;margin:24px auto;padding:0 16px;line-height:1.55;color:#1f2937}h1{color:#0b5d3b}h2{margin-top:28px}p[lang]{color:#374151}small{color:#6b7280}</style></head><body>
<h1>AgriLink privacy notice</h1><small>Version ${PRIVACY_VERSION}</small>
${block("What we keep", "Your name, phone number, email, district and farm details; your listings, orders, ratings, ledger and other records you enter; and photos you choose to upload. Group chat uses a random name — your real name and phone are never shown there.", "ඔබේ නම, දුරකථන අංකය, විද්‍යුත් තැපෑල, දිස්ත්‍රික්කය සහ ගොවිපල විස්තර; ඔබ ඇතුළත් කරන ලැයිස්තු, ඇණවුම්, ශ්‍රේණිගත කිරීම්, ගිණුම් සහ වෙනත් වාර්තා; ඔබ උඩුගත කරන ඡායාරූප. කණ්ඩායම් කතාබහේදී අහඹු නමක් භාවිතා වේ — ඔබේ සැබෑ නම හා දුරකථනය කිසිවිටෙක නොපෙන්වයි.", "உங்கள் பெயர், தொலைபேசி, மின்னஞ்சல், மாவட்டம், பண்ணை விவரங்கள்; நீங்கள் உள்ளிடும் பட்டியல்கள், ஆர்டர்கள், மதிப்பீடுகள், கணக்குகள்; நீங்கள் பதிவேற்றும் புகைப்படங்கள். குழு உரையாடலில் சீரற்ற பெயர் பயன்படுகிறது — உங்கள் உண்மையான பெயரும் தொலைபேசியும் காட்டப்படாது.")}
${block("Why", "To run the marketplace, deliveries, alerts and your own records. We do not sell your personal data.", "වෙළඳපොළ, බෙදාහැරීම්, දැනුම්දීම් සහ ඔබේ වාර්තා ක්‍රියාත්මක කිරීමට. ඔබේ පුද්ගලික දත්ත අපි විකුණන්නේ නැත.", "சந்தை, விநியோகம், எச்சரிக்கைகள் மற்றும் உங்கள் பதிவுகளை இயக்க. உங்கள் தனிப்பட்ட தரவை நாங்கள் விற்பதில்லை.")}
${block("Who can see what", "Buyers and farmers see each other’s name and (after an order is accepted) phone number. ID documents are seen only by the admin team and are deleted once checked.", "ඇණවුමක් පිළිගත් පසු ගැනුම්කරුවන්ට හා ගොවීන්ට එකිනෙකාගේ නම හා දුරකථන අංකය පෙනේ. හැඳුනුම් ලේඛන පෙනෙන්නේ පරිපාලන කණ්ඩායමට පමණි; පරීක්ෂා කළ පසු මකා දමයි.", "ஆர்டர் ஏற்கப்பட்ட பின் வாங்குபவர்களும் விவசாயிகளும் ஒருவருக்கொருவர் பெயர், தொலைபேசியைப் பார்ப்பார்கள். அடையாள ஆவணங்களை நிர்வாகக் குழு மட்டுமே பார்க்கும்; சரிபார்த்ததும் நீக்கப்படும்.")}
${block("Your rights", "In the app (Profile → Privacy) you can download all your data and delete your account at any time. Orders you completed stay for the other person’s records, with your name replaced.", "යෙදුමේ (පැතිකඩ → රහස්‍යතාව) ඔබේ සියලු දත්ත බාගත කර ඕනෑම වේලාවක ගිණුම මකා දැමිය හැක. ඔබ සම්පූර්ණ කළ ඇණවුම් අනෙක් පුද්ගලයාගේ වාර්තා සඳහා ඔබේ නම වෙනස් කර තබයි.", "செயலியில் (சுயவிவரம் → தனியுரிமை) உங்கள் தரவை பதிவிறக்கம் செய்யவும், எப்போது வேண்டுமானாலும் கணக்கை நீக்கவும் முடியும். நீங்கள் முடித்த ஆர்டர்கள் மற்றவரின் பதிவுக்காக உங்கள் பெயர் மாற்றப்பட்டு இருக்கும்.")}
<h2>Contact</h2><p>Questions: ${contact}.</p></body></html>`;
  res.set("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
}

/** GET /api/app/version — lets an old app tell the person to update. */
function appVersion(req, res) {
  return res.status(200).json({ success: true, data: {
    minVersion: process.env.APP_MIN_VERSION || "1.0.0",
    latestVersion: process.env.APP_LATEST_VERSION || "1.0.0",
    downloadUrl: process.env.APP_DOWNLOAD_URL || "",
    message: process.env.APP_UPDATE_MESSAGE || "",
    privacyVersion: PRIVACY_VERSION,
  } });
}

/** GET /api/auth/referrals — my code and how many people I brought. */
async function referrals(req, res) {
  const user = await User.findById(req.userId);
  const code = await ensureReferralCode(user);
  const invited = await User.find({ referredBy: user._id }).select("createdAt role").lean();
  return res.status(200).json({ success: true, data: { code, invited: invited.length, farmers: invited.filter((u) => u.role === "farmer").length } });
}

/** POST /api/notifications/device { token } and DELETE — so the server can push to this phone. */
async function registerDevice(req, res) {
  const token = String((req.body || {}).token || "").trim();
  if (token.length < 20 || token.length > 4096) return fail(res, 400, "Invalid device token.");
  await DeviceToken.updateOne({ token }, { $set: { user: req.userId, platform: String((req.body || {}).platform || "android").slice(0, 12) } }, { upsert: true });
  return res.status(200).json({ success: true });
}
async function unregisterDevice(req, res) {
  await DeviceToken.deleteMany({ user: req.userId, ...(req.body && req.body.token ? { token: req.body.token } : {}) });
  return res.status(200).json({ success: true });
}

module.exports = { consent, exportData, deleteAccount, privacyPage, appVersion, referrals, registerDevice, unregisterDevice, ensureReferralCode, PRIVACY_VERSION };
