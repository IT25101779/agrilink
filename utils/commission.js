/**
 * Shared platform commission rule, used anywhere a deal completes
 * (marketplace sale, confirmed crowdfunding pledge, lorry booking rent):
 * "we have to get 5% commission. if a business is under 1000 rupees, we
 * will not get commission — add some charge as a transaction fee instead."
 *
 * So: 5% commission on anything LKR 1000 or more; below that, a small flat
 * transaction fee instead of a percentage cut (so the platform still earns
 * something on tiny deals without the commission swallowing it whole).
 */
const PLATFORM_COMMISSION_RATE = 0.05; // 5%
const NO_COMMISSION_BELOW_LKR = 1000;
const FLAT_FEE_BELOW_THRESHOLD_LKR = 20; // small flat transaction fee instead of a percentage, for tiny deals

/**
 * @param {number} amountLkr - the full value of the completed deal
 * @returns {{ amountLkr: number, commissionLkr: number, netToFarmerLkr: number, feeType: "commission" | "flat_fee" }}
 */
function calculateCommission(amountLkr) {
  const amount = Math.max(0, Number(amountLkr) || 0);
  if (amount < NO_COMMISSION_BELOW_LKR) {
    const fee = Math.min(FLAT_FEE_BELOW_THRESHOLD_LKR, amount); // never charge more than the deal is worth
    return { amountLkr: amount, commissionLkr: Math.round(fee), netToFarmerLkr: Math.round(amount - fee), feeType: "flat_fee" };
  }
  const commission = Math.round(amount * PLATFORM_COMMISSION_RATE);
  return { amountLkr: amount, commissionLkr: commission, netToFarmerLkr: amount - commission, feeType: "commission" };
}

/**
 * Records one completed deal into PlatformCommissionLog. Never throws —
 * bookkeeping failing should never block the actual sale/pledge/booking
 * from completing, so this just logs and swallows any error.
 */
async function logCommission({ source, refId, farmer, amountLkr }) {
  try {
    const PlatformCommissionLog = require("../models/PlatformCommissionLog");
    const { commissionLkr, feeType } = calculateCommission(amountLkr);
    await PlatformCommissionLog.create({ source, refId, farmer, amountLkr, commissionLkr, feeType });
  } catch (error) {
    console.error("logCommission failed (non-fatal):", error.message);
  }
}

module.exports = { PLATFORM_COMMISSION_RATE, NO_COMMISSION_BELOW_LKR, FLAT_FEE_BELOW_THRESHOLD_LKR, calculateCommission, logCommission };
