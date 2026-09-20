const mongoose = require("mongoose");
const User = require("../models/User");
const CultivationTimeline = require("../models/CultivationTimeline");
const GroupMembership = require("../models/GroupMembership");
const GroupMessage = require("../models/GroupMessage");
const ChatMedia = require("../models/ChatMedia");
const ChatReport = require("../models/ChatReport");
const cfg = require("../utils/chatConfig");
const { translateFields } = require("../utils/translateText");

const { LIMITS } = cfg;
const MS_PER_MINUTE = 60 * 1000;

function isValidId(id) {
  return typeof id === "string" && mongoose.isValidObjectId(id);
}

function fail(res, status, message, code) {
  return res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
}

function firstDefined(...values) {
  return values.find((v) => v !== undefined && v !== null);
}

async function isBanned(userId) {
  const user = await User.findById(userId).select("chatBannedUntil");
  return user && user.chatBannedUntil && user.chatBannedUntil > new Date() ? user.chatBannedUntil : null;
}

async function requireMembership(req, res, groupKey) {
  const group = cfg.parseGroupKey(groupKey);
  if (!group) {
    fail(res, 400, "That group does not exist.");
    return null;
  }
  const membership = await GroupMembership.findOne({ user: req.userId, groupKey: group.key });
  if (!membership) {
    fail(res, 403, "Join this group first.");
    return null;
  }
  return { group, membership };
}

// ---------------- shaping ----------------

function shapeMessage(message, viewerId, membership) {
  const m = message.toObject ? message.toObject() : message;
  const mine = m.sender && String(m.sender) === String(viewerId);
  const helpfulBy = (m.helpfulBy || []).map(String);
  return {
    id: String(m._id),
    alias: m.alias,
    avatar: { hue: m.avatarHue, emoji: m.avatarEmoji },
    mine: Boolean(mine),
    type: m.type,
    text: m.text,
    media: m.mediaId ? { id: String(m.mediaId), kind: m.type === "voice" ? "voice" : "image", durationSec: m.durationSec || null } : null,
    replyTo: m.replyTo ? { id: String(m.replyTo), alias: m.replyPreview && m.replyPreview.alias, text: m.replyPreview && m.replyPreview.text, type: m.replyPreview && m.replyPreview.kind } : null,
    attachment: m.attachment || null,
    helpfulCount: helpfulBy.length,
    iFoundHelpful: helpfulBy.includes(String(viewerId)),
    createdAt: m.createdAt,
    // Only the SENDER learns that a message was hidden by reports.
    status: mine ? m.status : undefined,
  };
}

async function describeGroup(group, userId) {
  const [memberCount, membership, recentMessages] = await Promise.all([
    GroupMembership.countDocuments({ groupKey: group.key }),
    userId ? GroupMembership.findOne({ user: userId, groupKey: group.key }).select("_id") : null,
    GroupMessage.countDocuments({ groupKey: group.key, status: "visible", createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
  ]);
  return { ...group, memberCount, joined: Boolean(membership), messagesThisWeek: recentMessages };
}

// ---------------- groups ----------------

/** GET /api/group-chat/groups — groups I have joined, with unread counts and the latest message. */
async function listMyGroups(req, res) {
  try {
    const memberships = await GroupMembership.find({ user: req.userId }).lean();
    const groups = [];
    let unreadTotal = 0;
    for (const membership of memberships) {
      const group = cfg.parseGroupKey(membership.groupKey);
      if (!group) continue;
      const [memberCount, unread, last] = await Promise.all([
        GroupMembership.countDocuments({ groupKey: group.key }),
        GroupMessage.countDocuments({ groupKey: group.key, status: "visible", sender: { $ne: req.userId }, createdAt: { $gt: membership.lastReadAt } }),
        GroupMessage.findOne({ groupKey: group.key, status: "visible" }).sort({ _id: -1 }).lean(),
      ]);
      const unreadShown = membership.muted ? 0 : unread;
      unreadTotal += unreadShown;
      groups.push({
        ...group,
        alias: membership.alias,
        muted: membership.muted,
        memberCount,
        unread: unreadShown,
        last: last ? { alias: last.alias, type: last.type, text: last.type === "text" || last.type === "system" ? String(last.text).slice(0, 80) : "", createdAt: last.createdAt } : null,
      });
    }
    groups.sort((a, b) => new Date(b.last ? b.last.createdAt : 0) - new Date(a.last ? a.last.createdAt : 0));
    return res.status(200).json({ success: true, unreadTotal, data: groups });
  } catch (error) {
    console.error("listMyGroups error:", error);
    return fail(res, 500, "Failed to load your groups.");
  }
}

/** GET /api/group-chat/groups/suggested — groups that fit this farmer's district and crops. */
async function suggestedGroups(req, res) {
  try {
    const user = await User.findById(req.userId).select("farmerProfile.district");
    const district = cfg.canonicalDistrict(user && user.farmerProfile ? user.farmerProfile.district : "");
    const timelines = await CultivationTimeline.find({ farmer: req.userId, status: "active" }).select("cropType").lean();
    const crops = [...new Set(timelines.map((t) => cfg.canonicalCrop(t.cropType)).filter(Boolean))];

    const keys = ["all"];
    if (district) keys.push(`district:${district}`);
    for (const crop of crops) {
      keys.push(`crop:${crop}`);
      if (district) keys.push(`cropdist:${crop}|${district}`);
    }
    const described = await Promise.all(keys.map((k) => describeGroup(cfg.parseGroupKey(k), req.userId)));
    return res.status(200).json({ success: true, data: described.filter((g) => !g.joined), district, crops });
  } catch (error) {
    console.error("suggestedGroups error:", error);
    return fail(res, 500, "Failed to load suggestions.");
  }
}

/** GET /api/group-chat/groups/directory — EVERY group (All Sri Lanka, 25 districts, all crops), so farmers can browse and join without typing filters. */
async function directory(req, res) {
  try {
    const [memberships, recent] = await Promise.all([
      GroupMembership.find({}).select("groupKey user").lean(),
      GroupMessage.find({ status: "visible", createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }).select("groupKey").lean(),
    ]);
    const members = new Map(), weekly = new Map(), mine = new Set();
    memberships.forEach((m) => { members.set(m.groupKey, (members.get(m.groupKey) || 0) + 1); if (String(m.user) === String(req.userId)) mine.add(m.groupKey); });
    recent.forEach((m) => weekly.set(m.groupKey, (weekly.get(m.groupKey) || 0) + 1));
    const describe = (key) => ({ ...cfg.parseGroupKey(key), memberCount: members.get(key) || 0, messagesThisWeek: weekly.get(key) || 0, joined: mine.has(key) });
    return res.status(200).json({
      success: true,
      data: {
        all: describe("all"),
        districts: cfg.DISTRICTS.map((d) => describe(`district:${d}`)),
        crops: cfg.CROPS.map((c) => describe(`crop:${c}`)),
      },
    });
  } catch (error) {
    console.error("directory error:", error);
    return fail(res, 500, "Failed to load the group directory.");
  }
}

/** GET /api/group-chat/groups/search?district=&crop= — the groups a filter leads to, most specific first. */
async function searchGroups(req, res) {
  try {
    const { district, crop } = req.query;
    if (district && !cfg.canonicalDistrict(district)) return fail(res, 400, "Unknown district.");
    if (crop && !cfg.canonicalCrop(crop)) return fail(res, 400, "Unknown crop.");
    const chain = cfg.groupChain({ district, crop });
    const described = await Promise.all(chain.map((g) => describeGroup(g, req.userId)));
    return res.status(200).json({ success: true, data: described });
  } catch (error) {
    console.error("searchGroups error:", error);
    return fail(res, 500, "Failed to search groups.");
  }
}

/** POST /api/group-chat/groups/join  { groupKey } — idempotent; the alias never changes. */
async function joinGroup(req, res) {
  try {
    const group = cfg.parseGroupKey(req.body.groupKey);
    if (!group) return fail(res, 400, "That group does not exist.");
    if (await isBanned(req.userId)) return fail(res, 403, "You cannot join groups right now.", "banned");

    const existing = await GroupMembership.findOne({ user: req.userId, groupKey: group.key });
    if (existing) return res.status(200).json({ success: true, data: { ...(await describeGroup(group, req.userId)), alias: existing.alias, avatar: { hue: existing.avatarHue, emoji: existing.avatarEmoji } } });

    // Two people can (very rarely) get the same alias; try a few salts until it is unique in this group.
    let identity;
    for (let salt = 0; salt < 20; salt++) {
      identity = cfg.makeAlias(req.userId, group.key, salt);
      if (!(await GroupMembership.findOne({ groupKey: group.key, alias: identity.alias }).select("_id"))) break;
    }
    try {
      await GroupMembership.create({ user: req.userId, groupKey: group.key, alias: identity.alias, avatarHue: identity.avatarHue, avatarEmoji: identity.avatarEmoji });
    } catch (error) {
      if (error.code !== 11000) throw error; // joined twice at once — fine
    }
    const membership = await GroupMembership.findOne({ user: req.userId, groupKey: group.key });
    return res.status(200).json({ success: true, data: { ...(await describeGroup(group, req.userId)), alias: membership.alias, avatar: { hue: membership.avatarHue, emoji: membership.avatarEmoji } } });
  } catch (error) {
    console.error("joinGroup error:", error);
    return fail(res, 500, "Failed to join the group.");
  }
}

async function leaveGroup(req, res) {
  try {
    const group = cfg.parseGroupKey(req.body.groupKey);
    if (!group) return fail(res, 400, "That group does not exist.");
    await GroupMembership.deleteOne({ user: req.userId, groupKey: group.key });
    return res.status(200).json({ success: true, message: "You left the group." });
  } catch (error) {
    console.error("leaveGroup error:", error);
    return fail(res, 500, "Failed to leave the group.");
  }
}

async function setMuted(req, res) {
  try {
    const group = cfg.parseGroupKey(req.body.groupKey);
    if (!group) return fail(res, 400, "That group does not exist.");
    const result = await GroupMembership.updateOne({ user: req.userId, groupKey: group.key }, { $set: { muted: Boolean(req.body.muted) } });
    if (!result.matchedCount) return fail(res, 403, "Join this group first.");
    return res.status(200).json({ success: true, muted: Boolean(req.body.muted) });
  } catch (error) {
    console.error("setMuted error:", error);
    return fail(res, 500, "Failed to update the group.");
  }
}

/** POST /api/group-chat/groups/block { groupKey, alias, blocked } — hides one alias from ME in this group. */
async function setBlocked(req, res) {
  try {
    const ctx = await requireMembership(req, res, req.body.groupKey);
    if (!ctx) return;
    const alias = String(req.body.alias || "").slice(0, 60);
    if (!alias || alias === ctx.membership.alias) return fail(res, 400, "Choose another member to block.");
    const update = req.body.blocked === false ? { $pull: { blockedAliases: alias } } : { $addToSet: { blockedAliases: alias } };
    await GroupMembership.updateOne({ _id: ctx.membership._id }, update);
    return res.status(200).json({ success: true, message: req.body.blocked === false ? "Unblocked." : "You won't see messages from this member." });
  } catch (error) {
    console.error("setBlocked error:", error);
    return fail(res, 500, "Failed to update blocking.");
  }
}

// ---------------- messages ----------------

/**
 * GET /api/group-chat/messages?groupKey=&after=<id>&before=<id>&limit=
 * Default: the latest messages. `after` returns only NEWER ones (used for polling).
 */
async function getMessages(req, res) {
  try {
    const ctx = await requireMembership(req, res, req.query.groupKey);
    if (!ctx) return;
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit < 1) limit = LIMITS.pageSize;
    limit = Math.min(limit, LIMITS.maxPageSize);

    const filter = { groupKey: ctx.group.key, status: "visible" };
    if (ctx.membership.blockedAliases.length) filter.alias = { $nin: ctx.membership.blockedAliases };

    let messages;
    if (req.query.after && isValidId(String(req.query.after))) {
      filter._id = { $gt: req.query.after };
      messages = await GroupMessage.find(filter).sort({ _id: 1 }).limit(limit);
    } else {
      if (req.query.before && isValidId(String(req.query.before))) filter._id = { $lt: req.query.before };
      messages = (await GroupMessage.find(filter).sort({ _id: -1 }).limit(limit)).reverse();
    }

    // The sender should also see their own messages that reports have hidden, marked as such.
    await GroupMembership.updateOne({ _id: ctx.membership._id }, { $set: { lastReadAt: new Date() } });
    return res.status(200).json({
      success: true,
      data: messages.map((m) => shapeMessage(m, req.userId, ctx.membership)),
      hasMore: !req.query.after && messages.length === limit,
      alias: ctx.membership.alias,
    });
  } catch (error) {
    console.error("getMessages error:", error);
    return fail(res, 500, "Failed to load messages.");
  }
}

function decodeBase64(value) {
  const text = String(value || "").replace(/^data:[^;]+;base64,/, "");
  if (!text || !/^[A-Za-z0-9+/=\s]+$/.test(text)) return null;
  return Buffer.from(text, "base64");
}

function cleanAttachment(attachment) {
  if (!attachment || typeof attachment !== "object" || attachment.kind !== "scan") return null;
  const short = (v, n = 80) => String(v || "").slice(0, n);
  return {
    kind: "scan",
    cropType: short(attachment.cropType),
    disease: short(attachment.disease),
    severity: short(attachment.severity, 40),
    confidencePercent: Math.max(0, Math.min(100, Math.round(Number(attachment.confidencePercent) || 0))),
    healthy: attachment.healthy === true,
  };
}

/**
 * POST /api/group-chat/messages
 * Body: { groupKey, type: "text"|"image"|"voice"|"scan", text?, imageBase64?, voiceBase64?, durationSec?, replyToId?, attachment? }
 */
async function postMessage(req, res) {
  try {
    const ctx = await requireMembership(req, res, req.body.groupKey);
    if (!ctx) return;
    if (await isBanned(req.userId)) return fail(res, 403, "You cannot post right now.", "banned");

    const type = String(req.body.type || "text");
    if (!["text", "image", "voice", "scan"].includes(type)) return fail(res, 400, "Unknown message type.");

    // ---- rate limits (counted from the database, so they hold on every server instance) ----
    const since = new Date(Date.now() - MS_PER_MINUTE);
    const [recent, recentMedia] = await Promise.all([
      GroupMessage.countDocuments({ sender: req.userId, createdAt: { $gte: since } }),
      GroupMessage.countDocuments({ sender: req.userId, createdAt: { $gte: since }, type: { $in: ["image", "voice"] } }),
    ]);
    if (recent >= LIMITS.messagesPerMinute || ((type === "image" || type === "voice") && recentMedia >= LIMITS.mediaPerMinute)) {
      return fail(res, 429, "You are sending messages very fast. Please wait a moment.", "rate_limited");
    }

    // ---- text / caption ----
    const text = cfg.cleanText(firstDefined(req.body.text, ""));
    const content = cfg.checkContent(text);
    if (!content.ok) return fail(res, 400, "This message can't be sent.", content.code);
    if (type === "text" && !text) return fail(res, 400, "Write a message first.");

    // ---- reply ----
    let replyTo = null;
    let replyPreview = null;
    if (req.body.replyToId) {
      if (!isValidId(String(req.body.replyToId))) return fail(res, 400, "Invalid reply.");
      const original = await GroupMessage.findOne({ _id: req.body.replyToId, groupKey: ctx.group.key, status: "visible" });
      if (!original) return fail(res, 400, "The message you are replying to is not available.");
      replyTo = original._id;
      replyPreview = { alias: original.alias, kind: original.type, text: original.type === "text" ? original.text.slice(0, 80) : "" };
    }

    const doc = {
      groupKey: ctx.group.key,
      sender: req.userId,
      alias: ctx.membership.alias,
      avatarHue: ctx.membership.avatarHue,
      avatarEmoji: ctx.membership.avatarEmoji,
      type,
      text,
      replyTo,
      replyPreview,
    };

    // ---- media: check the real bytes ----
    if (type === "image" || type === "voice") {
      const bytes = decodeBase64(type === "image" ? req.body.imageBase64 : req.body.voiceBase64);
      if (!bytes || bytes.length === 0) return fail(res, 400, type === "image" ? "The photo could not be read." : "The voice message could not be read.");
      const limit = type === "image" ? LIMITS.imageMaxBytes : LIMITS.voiceMaxBytes;
      if (bytes.length > limit) return fail(res, 413, type === "image" ? "This photo is too large." : "This voice message is too long.", "too_large");
      const mime = type === "image" ? cfg.sniffImage(bytes) : cfg.sniffAudio(bytes);
      if (!mime) return fail(res, 400, type === "image" ? "Only JPEG, PNG or WebP photos are allowed." : "This audio format is not supported.", "bad_format");

      let durationSec;
      if (type === "voice") {
        durationSec = Number(req.body.durationSec);
        if (!Number.isFinite(durationSec) || durationSec < 1) return fail(res, 400, "Voice message is too short.");
        if (durationSec > LIMITS.voiceMaxSeconds) return fail(res, 400, `Voice messages can be at most ${LIMITS.voiceMaxSeconds} seconds.`, "too_long");
        durationSec = Math.round(durationSec);
      }
      const media = await ChatMedia.create({ groupKey: ctx.group.key, uploader: req.userId, kind: type, mime, data: bytes, size: bytes.length, durationSec });
      doc.mediaId = media._id;
      doc.durationSec = durationSec;
    }

    if (type === "scan") {
      const attachment = cleanAttachment(req.body.attachment);
      if (!attachment) return fail(res, 400, "That scan can't be shared.");
      doc.attachment = attachment;
    }

    const saved = await GroupMessage.create(doc);
    await GroupMembership.updateOne({ _id: ctx.membership._id }, { $set: { lastReadAt: new Date() } });
    return res.status(201).json({ success: true, data: shapeMessage(saved, req.userId, ctx.membership) });
  } catch (error) {
    console.error("postMessage error:", error);
    return fail(res, 500, "Failed to send the message.");
  }
}

/** Loads a message and checks the caller belongs to its group. */
async function messageForMember(req, res, messageId) {
  if (!isValidId(String(messageId))) {
    fail(res, 400, "Invalid message.");
    return null;
  }
  const message = await GroupMessage.findById(messageId);
  if (!message) {
    fail(res, 404, "Message not found.");
    return null;
  }
  const membership = await GroupMembership.findOne({ user: req.userId, groupKey: message.groupKey });
  if (!membership) {
    fail(res, 403, "Join this group first.");
    return null;
  }
  return { message, membership };
}

/** POST /api/group-chat/messages/helpful { messageId } — toggles "this helped me". */
async function toggleHelpful(req, res) {
  try {
    const ctx = await messageForMember(req, res, req.body.messageId);
    if (!ctx) return;
    const { message } = ctx;
    if (message.status !== "visible") return fail(res, 404, "Message not found.");
    if (message.sender && String(message.sender) === String(req.userId)) return fail(res, 400, "You can't mark your own message.");
    const already = message.helpfulBy.map(String).includes(String(req.userId));
    const updated = await GroupMessage.findByIdAndUpdate(message._id, already ? { $pull: { helpfulBy: req.userId } } : { $addToSet: { helpfulBy: req.userId } }, { new: true });
    return res.status(200).json({ success: true, iFoundHelpful: !already, helpfulCount: updated.helpfulBy.length });
  } catch (error) {
    console.error("toggleHelpful error:", error);
    return fail(res, 500, "Failed to update.");
  }
}

/** POST /api/group-chat/messages/report { messageId, reason } */
async function reportMessage(req, res) {
  try {
    const ctx = await messageForMember(req, res, req.body.messageId);
    if (!ctx) return;
    const { message } = ctx;
    if (message.sender && String(message.sender) === String(req.userId)) return fail(res, 400, "You can't report your own message.");
    if (!message.sender) return fail(res, 400, "System messages can't be reported.");
    const reason = cfg.REPORT_REASONS.includes(req.body.reason) ? req.body.reason : "other";

    try {
      await ChatReport.create({ message: message._id, reporter: req.userId, reason });
    } catch (error) {
      if (error.code === 11000) return res.status(200).json({ success: true, message: "Thanks — you already reported this message." });
      throw error;
    }
    const total = await ChatReport.countDocuments({ message: message._id, status: "open" });
    const update = { reportCount: total };
    if (total >= LIMITS.autoHideAtReports && message.status === "visible") update.status = "hidden";
    await GroupMessage.updateOne({ _id: message._id }, { $set: update });
    return res.status(200).json({ success: true, message: "Thank you. Our team will review this message." });
  } catch (error) {
    console.error("reportMessage error:", error);
    return fail(res, 500, "Failed to report the message.");
  }
}

/** POST /api/group-chat/messages/delete { messageId } — you can delete your own messages. */
async function deleteMyMessage(req, res) {
  try {
    if (!isValidId(String(req.body.messageId))) return fail(res, 400, "Invalid message.");
    const message = await GroupMessage.findById(req.body.messageId);
    if (!message) return fail(res, 404, "Message not found.");
    if (!message.sender || String(message.sender) !== String(req.userId)) return fail(res, 403, "You can only delete your own messages.");
    await GroupMessage.updateOne({ _id: message._id }, { $set: { status: "removed", removedReason: "deleted_by_sender", text: "" } });
    if (message.mediaId) await ChatMedia.deleteOne({ _id: message.mediaId });
    return res.status(200).json({ success: true, message: "Message deleted." });
  } catch (error) {
    console.error("deleteMyMessage error:", error);
    return fail(res, 500, "Failed to delete the message.");
  }
}

/** GET /api/group-chat/media/:id — the photo or voice note, for members of that group only. */
async function getMedia(req, res) {
  try {
    if (!isValidId(String(req.params.id))) return fail(res, 400, "Invalid media.");
    const media = await ChatMedia.findById(req.params.id);
    if (!media) return fail(res, 404, "Not found.");
    const membership = await GroupMembership.findOne({ user: req.userId, groupKey: media.groupKey });
    if (!membership) return fail(res, 403, "Join this group first.");
    const message = await GroupMessage.findOne({ mediaId: media._id }).select("status");
    if (!message || message.status === "removed") return fail(res, 404, "Not found.");
    res.set("Content-Type", media.mime);
    res.set("Cache-Control", "private, max-age=86400");
    return res.status(200).send(media.data);
  } catch (error) {
    console.error("getMedia error:", error);
    return fail(res, 500, "Failed to load the file.");
  }
}

/** POST /api/group-chat/messages/translate { messageId, target: "en"|"si"|"ta" } */
async function translateMessage(req, res) {
  try {
    const ctx = await messageForMember(req, res, req.body.messageId);
    if (!ctx) return;
    const target = ["en", "si", "ta"].includes(req.body.target) ? req.body.target : "en";
    const { message } = ctx;
    if (message.status !== "visible" || !message.text) return fail(res, 400, "Nothing to translate.");
    const result = await translateFields({ text: message.text }, target);
    const translated = result && result.text ? result.text : message.text;
    return res.status(200).json({ success: true, translated, changed: translated !== message.text });
  } catch (error) {
    console.error("translateMessage error:", error);
    return fail(res, 500, "Translation is not available right now.");
  }
}

/**
 * Called by the disease scanner when it detects a regional outbreak: posts a
 * system message in the matching crop + district group (if anyone is in it),
 * at most once a day per disease.
 */
async function postOutbreakAlert({ farmerId, cropType, disease, count }) {
  const user = await User.findById(farmerId).select("farmerProfile.district");
  const key = cfg.buildGroupKey({ district: user && user.farmerProfile ? user.farmerProfile.district : null, crop: cropType });
  const group = cfg.parseGroupKey(key);
  if (!group || group.scope !== "cropdist") return null;
  if (!(await GroupMembership.findOne({ groupKey: group.key }).select("_id"))) return null;

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const already = await GroupMessage.findOne({ groupKey: group.key, type: "system", "attachment.disease": disease, createdAt: { $gte: dayAgo } }).select("_id");
  if (already) return null;

  return GroupMessage.create({
    groupKey: group.key,
    alias: "AgriLink",
    avatarEmoji: "📣",
    type: "system",
    text: `Outbreak alert: ${count} farmers nearby have reported ${disease} on ${group.crop}. Check your plants and share photos here.`,
    attachment: { kind: "outbreak", disease: String(disease).slice(0, 80), cropType: group.crop, count },
  });
}

module.exports = {
  listMyGroups, suggestedGroups, searchGroups, directory, joinGroup, leaveGroup, setMuted, setBlocked,
  getMessages, postMessage, toggleHelpful, reportMessage, deleteMyMessage, getMedia, translateMessage,
  postOutbreakAlert,
};
