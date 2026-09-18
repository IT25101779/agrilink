/**
 * Thin wrapper around Meta's WhatsApp Cloud API (Graph API).
 *
 * Setup required (see .env.example):
 *   WHATSAPP_PHONE_NUMBER_ID  — from your Meta app's WhatsApp > API Setup page
 *   WHATSAPP_ACCESS_TOKEN     — a permanent access token for that app
 *   WHATSAPP_API_VERSION      — optional, defaults to v20.0
 *
 * IMPORTANT — WhatsApp's messaging policy (this is not optional, Meta
 * enforces it server-side):
 *   - sendWhatsAppText() only succeeds if the recipient messaged your
 *     WhatsApp Business number within the last 24 hours ("customer service
 *     window"). This is fine for replying to an inbound chat message, but
 *     will silently fail for proactively-sent reminders to someone who
 *     hasn't messaged you recently.
 *   - To message someone OUTSIDE that 24-hour window (e.g. a weather
 *     reminder nobody asked for in the last day), you must use a
 *     pre-approved message template via sendWhatsAppTemplate() instead.
 *     Templates are created and submitted for approval in Meta Business
 *     Manager (WhatsApp Manager > Message Templates) — approval usually
 *     takes minutes to a few hours the first time.
 */

const GRAPH_VERSION = process.env.WHATSAPP_API_VERSION || "v20.0";

function getConfig() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    throw new Error("WhatsApp is not configured — set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in .env.");
  }
  return { phoneNumberId, accessToken };
}

async function callGraphApi(payload) {
  const { phoneNumberId, accessToken } = getConfig();
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage = data?.error?.message || `WhatsApp API returned status ${response.status}`;
    throw new Error(errorMessage);
  }
  return data;
}

/**
 * Freeform text reply. Only works within the 24-hour customer service
 * window (i.e. the recipient messaged you recently). Use this for
 * replying to inbound chat messages.
 */
async function sendWhatsAppText(toDigits, body) {
  return callGraphApi({
    messaging_product: "whatsapp",
    to: toDigits,
    type: "text",
    text: { body },
  });
}

/**
 * Pre-approved template message. Required for proactively messaging
 * someone outside the 24-hour window (e.g. reminders). templateName and
 * languageCode must match a template you've created and had approved in
 * WhatsApp Manager. `bodyParams` fills the template's {{1}}, {{2}}...
 * placeholders in order, if your template has any.
 */
async function sendWhatsAppTemplate(toDigits, templateName, languageCode = "en", bodyParams = []) {
  return callGraphApi({
    messaging_product: "whatsapp",
    to: toDigits,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: bodyParams.length
        ? [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text: String(text) })) }]
        : undefined,
    },
  });
}

module.exports = { sendWhatsAppText, sendWhatsAppTemplate };
