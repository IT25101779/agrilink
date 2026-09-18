/**
 * Translates farmer-facing text into Sinhala or Tamil using the same
 * Anthropic API already used for the chat assistant (see
 * controllers/chatController.js) — no new API key or service needed.
 *
 * Used specifically for disease-scan results: the Kindwise Crop.health
 * API only returns English disease names/treatment text, and there's no
 * language parameter it supports. Rather than storing a translated copy
 * (which would break outbreak-cluster matching in diseaseController.js,
 * since that logic matches on an exact detectedDisease string), this
 * translates ONLY the response payload sent back to the requesting
 * client — the database always keeps the canonical English text.
 *
 * Returns the original English text unchanged if translation fails for
 * any reason (missing API key, network issue, etc.) — a scan result in
 * the wrong language is much better than a scan result that fails
 * outright because a translation call had a hiccup.
 */

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-5";

const LANGUAGE_NAMES = { si: "Sinhala", ta: "Tamil", en: "English" };

/**
 * Translates a small object of English strings in one API call (cheaper
 * and simpler than one call per field). Pass a flat object of
 * { key: "English text", ... } and get back { key: "Translated text", ... }
 * with the same keys, same shape.
 */
async function translateFields(fields, targetLanguage) {
  if (!targetLanguage || targetLanguage === "en") return fields;
  const languageName = LANGUAGE_NAMES[targetLanguage];
  if (!languageName) return fields;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("translateFields: ANTHROPIC_API_KEY not set, returning original English text.");
    return fields;
  }

  // Skip entirely if there's nothing non-empty to translate.
  const hasContent = Object.values(fields).some((v) => typeof v === "string" && v.trim().length > 0);
  if (!hasContent) return fields;

  try {
    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 800,
        system: `You translate short agricultural/plant-disease terms and instructions from English to ${languageName} for Sri Lankan smallholder farmers. Respond ONLY with a single valid JSON object, same keys as the input, values translated to ${languageName}. Keep plant/disease names recognizable (a farmer should still recognize the disease name even in translation). No markdown, no explanation, no code fences — just the raw JSON object.`,
        messages: [{ role: "user", content: JSON.stringify(fields) }],
      }),
    });

    if (!response.ok) {
      console.error("translateFields: Anthropic API error", response.status, await response.text());
      return fields;
    }

    const data = await response.json();
    const text = data.content?.find((block) => block.type === "text")?.text || "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    const translated = JSON.parse(cleaned);

    // Defensive: only accept keys that were actually in the input, and
    // fall back to the English original for any key the model dropped.
    const result = {};
    for (const key of Object.keys(fields)) {
      result[key] = typeof translated[key] === "string" && translated[key].trim() ? translated[key] : fields[key];
    }
    return result;
  } catch (error) {
    console.error("translateFields failed, returning original English text:", error.message);
    return fields;
  }
}

module.exports = { translateFields };
