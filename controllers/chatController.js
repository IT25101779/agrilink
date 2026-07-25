const ChatMessage = require("../models/ChatMessage");
const CultivationTimeline = require("../models/CultivationTimeline");

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-5";
const HISTORY_MESSAGES_LIMIT = 12; // recent turns kept for conversational context

const LANGUAGE_NAMES = { si: "Sinhala", ta: "Tamil", en: "English" };

function buildSystemPrompt(language, timelineContext) {
  const languageName = LANGUAGE_NAMES[language] || "English";

  let contextBlock = "The farmer has no active crop timeline on record yet.";
  if (timelineContext) {
    const dayNumber = Math.floor(
      (Date.now() - new Date(timelineContext.plantingDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    const upcomingMilestones = timelineContext.milestones
      .filter((m) => !m.isCompleted)
      .slice(0, 3)
      .map((m) => `Day ${m.day}: ${m.title}`)
      .join("; ");

    contextBlock = `The farmer's active crop is ${timelineContext.cropType} on ${timelineContext.landSizeAcres} acres of ${timelineContext.soilType} soil. They are currently on day ${dayNumber} of their growth cycle. Upcoming steps in their checklist: ${upcomingMilestones || "none remaining"}.`;
  }

  return `You are AgriLink AI's assistant for Sri Lankan smallholder farmers. Respond ONLY in ${languageName}, in a warm, practical, plain-language tone suitable for a farmer with limited formal education — short sentences, concrete steps, no jargon.

Context about this farmer's current situation:
${contextBlock}

Use this context to make your advice specific to their actual crop and current growth stage whenever relevant. If asked something unrelated to farming, gently redirect to how you can help with their crops, weather, market prices, or pest/disease issues. Keep responses concise — 3-5 sentences unless the farmer asks for a detailed explanation.`;
}

/**
 * POST /api/chat/message
 * Body: { farmer, message, language }
 * Sends the farmer's message to Claude with their current timeline context
 * injected into the system prompt, stores both sides of the exchange, and
 * returns the assistant's reply.
 */
async function sendMessage(req, res) {
  try {
    const { farmer, message, language } = req.body;

    if (!farmer || !message) {
      return res.status(400).json({ success: false, message: "farmer and message are required." });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "ANTHROPIC_API_KEY is not configured on the server. Add it to your .env file.",
      });
    }

    const chatLanguage = language || "en";

    // Pull the farmer's most recently updated active timeline for context.
    // Gracefully returns null if none exists yet — the assistant still works,
    // just without crop-specific personalization until one is synced.
    const timelineContext = await CultivationTimeline.findOne({ farmer, status: "active" }).sort({ updatedAt: -1 });

    const recentHistory = await ChatMessage.find({ farmer })
      .sort({ createdAt: -1 })
      .limit(HISTORY_MESSAGES_LIMIT)
      .then((docs) => docs.reverse());

    const anthropicMessages = [
      ...recentHistory.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    const claudeResponse = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 500,
        system: buildSystemPrompt(chatLanguage, timelineContext),
        messages: anthropicMessages,
      }),
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error("Anthropic API error:", claudeResponse.status, errorText);
      return res.status(502).json({ success: false, message: "Chat assistant is temporarily unavailable.", details: errorText });
    }

    const claudeData = await claudeResponse.json();
    const replyText = claudeData.content?.find((block) => block.type === "text")?.text || "";

    await ChatMessage.create({ farmer, role: "user", content: message, language: chatLanguage });
    const assistantMessage = await ChatMessage.create({
      farmer,
      role: "assistant",
      content: replyText,
      language: chatLanguage,
    });

    return res.status(200).json({
      success: true,
      data: {
        reply: replyText,
        messageId: assistantMessage._id,
        hadTimelineContext: !!timelineContext,
      },
    });
  } catch (error) {
    console.error("sendMessage error:", error);
    return res.status(500).json({ success: false, message: "Failed to process chat message.", error: error.message });
  }
}

/**
 * GET /api/chat/history?farmer=X
 */
async function getHistory(req, res) {
  try {
    const { farmer } = req.query;
    if (!farmer) {
      return res.status(400).json({ success: false, message: "farmer is required." });
    }
    const messages = await ChatMessage.find({ farmer }).sort({ createdAt: 1 }).limit(100);
    return res.status(200).json({ success: true, data: messages });
  } catch (error) {
    console.error("getHistory error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch chat history.", error: error.message });
  }
}

module.exports = { sendMessage, getHistory };
