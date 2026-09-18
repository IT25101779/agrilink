/**
 * Sri Lankan phone numbers get typed inconsistently at registration
 * (0771234567, +94771234567, 94771234567, with spaces/dashes...) but
 * WhatsApp's webhook always sends the sender as bare digits with country
 * code and no "+" (e.g. "94771234567"). This normalizes any of those
 * input formats to that same bare-digit shape so we can reliably match
 * an incoming WhatsApp message to a User by phone number.
 *
 * Defaults to Sri Lanka's country code (94) since that's this platform's
 * target market — swap the default if you expand beyond Sri Lanka.
 */
function normalizePhoneDigits(phone, defaultCountryCode = "94") {
  if (!phone) return null;
  let digits = String(phone).replace(/[^\d]/g, "");
  if (!digits) return null;

  if (digits.startsWith("0")) {
    // Local format (0771234567) -> country code + national number
    digits = defaultCountryCode + digits.slice(1);
  } else if (digits.length === 9) {
    // Bare 9-digit national number with no leading 0 and no country code
    digits = defaultCountryCode + digits;
  }
  // Otherwise assume it already includes a country code.

  return digits;
}

module.exports = { normalizePhoneDigits };
