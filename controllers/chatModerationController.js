const mongoose = require("mongoose");
const User = require("../models/User");
const GroupMessage = require("../models/GroupMessage");
const GroupMembership = require("../models/GroupMembership");
const ChatMedia = require("../models/ChatMedia");
const ChatReport = require("../models/ChatReport");

function isValidId(id) {
  return typeof id === "string" && mongoose.isValidObjectId(id);
}

/**
 * GET /api/admin/chat/reports?status=open
 * Reported messages with the REAL sender (only admins ever see this).
 */
async function listReports(req, res) {
  try {
    const status = ["open", "dismissed", "actioned"].includes(req.query.status) ? req.query.status : "open";
    const reports = await ChatReport.find({ status }).sort({ createdAt: -1 }).limit(200).lean();
    const byMessage = new Map();
    for (const r of reports) {
      const key = String(r.message);
      if (!byMessage.has(key)) byMessage.set(key, { messageId: key, reasons: [], reports: 0, latest: r.createdAt });
      const entry = byMessage.get(key);
      entry.reports += 1;
      entry.reasons.push(r.reason);
    }
    const items = [];
    for (const entry of byMessage.values()) {
      const message = await GroupMessage.findById(entry.messageId).lean();
      if (!message) continue;
      const sender = message.sender ? await User.findById(message.sender).select("fullName phone email chatBannedUntil").lean() : null;
      items.push({
        ...entry,
        reasons: [...new Set(entry.reasons)],
        groupKey: message.groupKey,
        alias: message.alias,
        type: message.type,
        text: message.text,
        hasMedia: Boolean(message.mediaId),
        mediaId: message.mediaId ? String(message.mediaId) : null,
        messageStatus: message.status,
        sentAt: message.createdAt,
        sender: sender ? { id: String(sender._id), name: sender.fullName, phone: sender.phone, email: sender.email, bannedUntil: sender.chatBannedUntil || null } : null,
      });
    }
    items.sort((a, b) => new Date(b.latest) - new Date(a.latest));
    return res.status(200).json({ success: true, count: items.length, data: items });
  } catch (error) {
    console.error("listReports error:", error);
    return res.status(500).json({ success: false, message: "Failed to load reports." });
  }
}

/** GET /api/admin/chat/media/:id — lets the moderator SEE a reported photo (admins bypass group membership). */
async function getMediaForAdmin(req, res) {
  try {
    if (!isValidId(String(req.params.id))) return res.status(400).json({ success: false, message: "Invalid media." });
    const media = await ChatMedia.findById(req.params.id);
    if (!media) return res.status(404).json({ success: false, message: "Not found." });
    res.set("Content-Type", media.mime);
    res.set("Cache-Control", "private, no-store");
    return res.status(200).send(media.data);
  } catch (error) {
    console.error("getMediaForAdmin error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the file." });
  }
}

/** POST /api/admin/chat/messages/remove { messageId, reason } — removes the message and closes its reports as "actioned". */
async function removeMessage(req, res) {
  try {
    if (!isValidId(String(req.body.messageId))) return res.status(400).json({ success: false, message: "Invalid message." });
    const message = await GroupMessage.findById(req.body.messageId);
    if (!message) return res.status(404).json({ success: false, message: "Message not found." });
    await GroupMessage.updateOne({ _id: message._id }, { $set: { status: "removed", removedReason: String(req.body.reason || "removed_by_admin").slice(0, 100) } });
    if (message.mediaId) await ChatMedia.deleteOne({ _id: message.mediaId });
    await ChatReport.updateMany({ message: message._id, status: "open" }, { $set: { status: "actioned" } });
    return res.status(200).json({ success: true, message: "Message removed." });
  } catch (error) {
    console.error("removeMessage error:", error);
    return res.status(500).json({ success: false, message: "Failed to remove the message." });
  }
}

/** POST /api/admin/chat/messages/restore { messageId } — a false alarm: show it again and dismiss the reports. */
async function restoreMessage(req, res) {
  try {
    if (!isValidId(String(req.body.messageId))) return res.status(400).json({ success: false, message: "Invalid message." });
    const message = await GroupMessage.findById(req.body.messageId);
    if (!message) return res.status(404).json({ success: false, message: "Message not found." });
    if (message.status === "removed") return res.status(409).json({ success: false, message: "Removed messages can't be restored." });
    await GroupMessage.updateOne({ _id: message._id }, { $set: { status: "visible", reportCount: 0 } });
    await ChatReport.updateMany({ message: message._id, status: "open" }, { $set: { status: "dismissed" } });
    return res.status(200).json({ success: true, message: "Message restored and reports dismissed." });
  } catch (error) {
    console.error("restoreMessage error:", error);
    return res.status(500).json({ success: false, message: "Failed to restore the message." });
  }
}

/** POST /api/admin/chat/ban { userId, days, unban? } */
async function banUser(req, res) {
  try {
    if (!isValidId(String(req.body.userId))) return res.status(400).json({ success: false, message: "Invalid user." });
    if (req.body.unban === true) {
      await User.updateOne({ _id: req.body.userId }, { $unset: { chatBannedUntil: 1 } });
      return res.status(200).json({ success: true, message: "User can chat again." });
    }
    const days = Number(req.body.days);
    if (!Number.isFinite(days) || days < 1 || days > 3650) return res.status(400).json({ success: false, message: "days must be between 1 and 3650." });
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const result = await User.updateOne({ _id: req.body.userId, role: "farmer" }, { $set: { chatBannedUntil: until } });
    if (!result.matchedCount) return res.status(404).json({ success: false, message: "Farmer not found." });
    return res.status(200).json({ success: true, message: `User cannot chat until ${until.toISOString().slice(0, 10)}.`, bannedUntil: until });
  } catch (error) {
    console.error("banUser error:", error);
    return res.status(500).json({ success: false, message: "Failed to update the user." });
  }
}

/** GET /api/admin/chat/stats */
async function chatStats(req, res) {
  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [messages, messages24h, members, openReports, hidden] = await Promise.all([
      GroupMessage.countDocuments({ status: "visible" }),
      GroupMessage.countDocuments({ status: "visible", createdAt: { $gte: dayAgo } }),
      GroupMembership.countDocuments({}),
      ChatReport.countDocuments({ status: "open" }),
      GroupMessage.countDocuments({ status: "hidden" }),
    ]);
    const recent = await GroupMessage.find({ createdAt: { $gte: dayAgo }, status: "visible" }).select("groupKey").lean();
    const counts = new Map();
    recent.forEach((m) => counts.set(m.groupKey, (counts.get(m.groupKey) || 0) + 1));
    const busiestGroups = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([groupKey, count]) => ({ groupKey, messages24h: count }));
    return res.status(200).json({ success: true, data: { messages, messages24h, memberships: members, openReports, hiddenMessages: hidden, busiestGroups } });
  } catch (error) {
    console.error("chatStats error:", error);
    return res.status(500).json({ success: false, message: "Failed to load chat statistics." });
  }
}

module.exports = { listReports, getMediaForAdmin, removeMessage, restoreMessage, banUser, chatStats };
