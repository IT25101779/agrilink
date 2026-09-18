const User = require("../models/User");
const Reminder = require("../models/Reminder");
const { getAssistantReply } = require("./chatController");
const { sendWhatsAppText } = require("../utils/whatsappService");
const { normalizePhoneDigits } = require("../utils/phoneUtils");

/**
 * GET /api/whatsapp/webhook
 * Meta's one-time verification handshake when you register this URL as
 * your app's webhook in Meta Business Manager / WhatsApp Manager. Must
 * echo back hub.challenge if hub.verify_token matches what you set.
 */
function verifyWebhook(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

/**
 * POST /api/whatsapp/webhook
 * Fires whenever a farmer sends your WhatsApp Business number a message.
 * Matches the sender's phone number to a registered farmer, forwards
 * their message to the same Claude-powered assistant the mobile app chat
 * screen uses, and replies on WhatsApp. Unrecognized numbers get a short
 * "register in the app first" reply rather than being silently dropped.
 *
 * Always acknowledges with 200 so Meta doesn't retry/disable the webhook
 * — WhatsApp expects a response within a few seconds.
 */
async function receiveWebhook(req, res) {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    // Meta also posts delivery/read status updates to this same webhook —
    // those don't have a `messages` array and aren't something we need to
    // act on here, so just acknowledge and stop.
    if (!message) {
      return res.sendStatus(200);
    }

    const fromDigits = message.from; // e.g. "94771234567" — already normalized by Meta
    const messageText = message.text?.body;

    if (!messageText) {
      await sendWhatsAppText(
        fromDigits,
        "I can only read text messages right now — please type your question, or use the AgriLink AI app's camera scanner for photos."
      ).catch((e) => console.error("WhatsApp reply failed:", e.message));
      return res.sendStatus(200);
    }

    // Practical matching approach: try the raw digits, then the same
    // digits with a leading 0 substituted for the country code, then a
    // "+"-prefixed form — covers the vast majority of how Sri Lankan
    // numbers get typed at registration (see utils/phoneUtils.js).
    const nationalWithZero = "0" + fromDigits.replace(/^94/, "");
    const candidateFarmer = await User.findOne({
      role: "farmer",
      $or: [{ phone: fromDigits }, { phone: nationalWithZero }, { phone: `+${fromDigits}` }],
    });

    if (!candidateFarmer) {
      await sendWhatsAppText(
        fromDigits,
        "Hi! I couldn't find an AgriLink AI account with this WhatsApp number. Please register in the app first (using this same phone number), then message me again."
      ).catch((e) => console.error("WhatsApp reply failed:", e.message));
      return res.sendStatus(200);
    }

    const language = candidateFarmer.preferredLanguage || "en";

    let replyText;
    try {
      const result = await getAssistantReply({ farmerId: candidateFarmer._id, message: messageText, language });
      replyText = result.reply;
    } catch (assistantError) {
      console.error("getAssistantReply failed for WhatsApp:", assistantError.message);
      replyText = "Sorry, I couldn't process that right now. Please try again in a moment.";
    }

    await sendWhatsAppText(fromDigits, replyText).catch((e) => console.error("WhatsApp reply failed:", e.message));

    return res.sendStatus(200);
  } catch (error) {
    console.error("receiveWebhook error:", error);
    // Still 200 — Meta disables webhooks after repeated non-200s, and
    // there's nothing Meta can retry-fix on their end for our bugs.
    return res.sendStatus(200);
  }
}

/**
 * POST /api/whatsapp/dispatch-reminders
 * Meant to be triggered on a schedule (Vercel Cron — see vercel.json)
 * rather than by a person. Sends any pending reminder that hasn't been
 * pushed to WhatsApp yet.
 *
 * IMPORTANT: this currently sends freeform text via sendWhatsAppText(),
 * which Meta only delivers if the farmer messaged your WhatsApp number
 * within the last 24 hours. For reminders to reach farmers who haven't
 * messaged recently, create and get a template approved in WhatsApp
 * Manager, then swap the call below for sendWhatsAppTemplate().
 *
 * Protected by a shared secret so this can't be triggered by the public
 * internet spamming your farmers.
 */
async function dispatchPendingReminders(req, res) {
  try {
    const providedSecret = req.headers["x-cron-secret"] || req.query.secret;
    if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const pending = await Reminder.find({ status: "pending", whatsappSentAt: null })
      .populate("farmer", "phone preferredLanguage")
      .limit(50);

    let sent = 0;
    let skippedNoPhone = 0;
    let failed = 0;

    for (const reminder of pending) {
      const phone = reminder.farmer?.phone;
      if (!phone) {
        skippedNoPhone++;
        continue;
      }
      const digits = normalizePhoneDigits(phone);
      try {
        await sendWhatsAppText(digits, `*${reminder.title}*\n\n${reminder.message}`);
        reminder.whatsappSentAt = new Date();
        await reminder.save();
        sent++;
      } catch (error) {
        console.error(`Failed to WhatsApp reminder ${reminder._id}:`, error.message);
        failed++;
      }
    }

    return res.status(200).json({ success: true, data: { checked: pending.length, sent, skippedNoPhone, failed } });
  } catch (error) {
    console.error("dispatchPendingReminders error:", error);
    return res.status(500).json({ success: false, message: "Failed to dispatch reminders.", error: error.message });
  }
}

module.exports = { verifyWebhook, receiveWebhook, dispatchPendingReminders };
