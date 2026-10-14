const mongoose = require("mongoose");
const ForwardContract = require("../models/ForwardContract");
const User = require("../models/User");
const { logCommission } = require("../utils/commission");

/**
 * FORWARD / CONTRACT LISTINGS — see models/ForwardContract.js for the full
 * design note. Two steps, never one: expressInterest (just a phone number
 * exchange) then confirmCommitment (the only step that actually counts
 * toward the contract and earns the platform its commission).
 */

const MAX_RETRIES = 3;

function isValidId(id) {
  return typeof id === "string" && mongoose.isValidObjectId(id);
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

/** POST /api/forward-contracts — a buyer posts a future commitment to buy. */
async function createContract(req, res) {
  try {
    const b = req.body || {};
    const totalQuantityKg = Number(b.totalQuantityKg);
    const lockedPricePerKg = Number(b.lockedPricePerKg);
    const deliverByDate = new Date(b.deliverByDate);
    if (!b.cropType || !Number.isFinite(totalQuantityKg) || totalQuantityKg <= 0 || !Number.isFinite(lockedPricePerKg) || lockedPricePerKg <= 0 || isNaN(deliverByDate.getTime())) {
      return res.status(400).json({ success: false, message: "cropType, totalQuantityKg, lockedPricePerKg and deliverByDate are required." });
    }
    if (deliverByDate < new Date()) {
      return res.status(400).json({ success: false, message: "deliverByDate must be in the future." });
    }
    const contract = await ForwardContract.create({
      buyer: req.userId,
      cropType: String(b.cropType).trim(),
      totalQuantityKg,
      lockedPricePerKg,
      deliverByDate,
      district: String(b.district || "").trim(),
      note: String(b.note || "").slice(0, 300),
    });
    return res.status(201).json({ success: true, message: "Forward contract posted.", data: contract });
  } catch (error) {
    console.error("createContract error:", error);
    return res.status(500).json({ success: false, message: "Failed to post contract." });
  }
}

/** GET /api/forward-contracts?cropType=&district=&status=open — browse (farmer-facing). */
async function listContracts(req, res) {
  try {
    const filter = { status: req.query.status || "open" };
    if (req.query.cropType) filter.cropType = req.query.cropType;
    if (req.query.district) filter.$or = [{ district: req.query.district }, { district: "" }];
    const contracts = await ForwardContract.find(filter)
      .populate("buyer", "fullName buyerProfile.companyName")
      .sort({ deliverByDate: 1 })
      .limit(100)
      .lean();
    return res.status(200).json({ success: true, data: contracts });
  } catch (error) {
    console.error("listContracts error:", error);
    return res.status(500).json({ success: false, message: "Failed to load contracts." });
  }
}

/** GET /api/forward-contracts/mine — the buyer's own posted contracts.
 * Commitments' farmer is populated with phone so the buyer-web "contracts"
 * tab can offer a tappable "Call" link before confirming — the same
 * phone-first pattern as crowdfunding and logistics bookings. */
async function getMyContracts(req, res) {
  const contracts = await ForwardContract.find({ buyer: req.userId })
    .populate("commitments.farmer", "fullName phone farmerProfile.district")
    .sort({ createdAt: -1 })
    .lean();
  return res.status(200).json({ success: true, data: contracts });
}

/** GET /api/forward-contracts/my-commitments — a farmer's own commitments across all contracts. */
async function getMyCommitments(req, res) {
  const contracts = await ForwardContract.find({ "commitments.farmer": req.userId })
    .select("cropType totalQuantityKg lockedPricePerKg deliverByDate district status commitments buyer")
    .populate("buyer", "fullName phone buyerProfile.companyName")
    .lean();
  const mine = contracts.map((c) => ({
    ...c,
    myCommitment: c.commitments.find((m) => String(m.farmer) === String(req.userId)),
    commitments: undefined,
  }));
  return res.status(200).json({ success: true, data: mine });
}

/** POST /api/forward-contracts/:id/interest — step 1: farmer expresses interest, gets the buyer's phone number. */
async function expressInterest(req, res) {
  try {
    const { id } = req.params;
    const quantityKg = Number((req.body || {}).quantityKg);
    if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid contract id." });
    if (!Number.isFinite(quantityKg) || quantityKg <= 0) return res.status(400).json({ success: false, message: "A positive quantityKg is required." });

    const contract = await ForwardContract.findById(id).populate("buyer", "fullName phone");
    if (!contract) return res.status(404).json({ success: false, message: "Contract not found." });
    if (contract.status !== "open") return res.status(409).json({ success: false, message: `This contract is no longer open (status: ${contract.status}).` });
    if (new Date(contract.deliverByDate) < new Date()) {
      await ForwardContract.updateOne({ _id: id, status: "open" }, { $set: { status: "expired" } });
      return res.status(409).json({ success: false, message: "This contract's delivery date has passed." });
    }

    const updated = await ForwardContract.findByIdAndUpdate(id, { $push: { commitments: { farmer: req.userId, quantityKg, status: "interested" } } }, { new: true });

    return res.status(200).json({
      success: true,
      message: "Interest recorded. Call the buyer to discuss, then confirm through the app to make it count.",
      buyerPhone: contract.buyer.phone,
      buyerName: contract.buyer.fullName,
      data: updated,
    });
  } catch (error) {
    console.error("expressInterest error:", error);
    return res.status(500).json({ success: false, message: "Failed to record interest." });
  }
}

/** PATCH /api/forward-contracts/:id/commitments/:commitmentId/confirm — step 2: locks it in after the phone call. */
async function confirmCommitment(req, res) {
  try {
    const { id, commitmentId } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid contract id." });

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const contract = await ForwardContract.findById(id);
      if (!contract) return res.status(404).json({ success: false, message: "Contract not found." });
      const commitment = contract.commitments.id(commitmentId);
      if (!commitment) return res.status(404).json({ success: false, message: "Commitment not found." });

      const isFarmer = String(commitment.farmer) === String(req.userId);
      const isBuyer = String(contract.buyer) === String(req.userId);
      if (!isFarmer && !isBuyer) return res.status(403).json({ success: false, message: "Only the farmer or the buyer can confirm this." });
      if (commitment.status !== "interested") return res.status(409).json({ success: false, message: `This commitment is already ${commitment.status}.` });
      if (contract.status !== "open") return res.status(409).json({ success: false, message: `This contract is no longer open (status: ${contract.status}).` });

      const remainingNeeded = contract.totalQuantityKg - contract.committedKg;
      if (remainingNeeded <= 0) return res.status(409).json({ success: false, message: "This contract's full quantity is already committed by other farmers." });
      const actualKg = Math.min(commitment.quantityKg, remainingNeeded);
      const newCommittedKg = contract.committedKg + actualKg;
      const fulfilled = newCommittedKg >= contract.totalQuantityKg;
      const dealValueLkr = round2(actualKg * contract.lockedPricePerKg);

      const updated = await ForwardContract.findOneAndUpdate(
        { _id: id, "commitments._id": commitmentId, "commitments.status": "interested", committedKg: contract.committedKg },
        {
          $set: {
            "commitments.$.status": "confirmed",
            "commitments.$.quantityKg": actualKg,
            "commitments.$.confirmedAt": new Date(),
            committedKg: newCommittedKg,
            status: fulfilled ? "fulfilled" : "open",
          },
        },
        { new: true }
      );

      if (updated) {
        await logCommission({ source: "forward_contract", refId: updated._id, farmer: commitment.farmer, amountLkr: dealValueLkr });
        return res.status(200).json({ success: true, message: "Commitment confirmed.", data: updated });
      }
      // Someone else confirmed something at the same instant — loop and re-read.
    }
    return res.status(409).json({ success: false, message: "This contract is receiving many confirmations right now. Please try again." });
  } catch (error) {
    console.error("confirmCommitment error:", error);
    return res.status(500).json({ success: false, message: "Failed to confirm commitment." });
  }
}

/** PATCH /api/forward-contracts/:id/cancel — buyer can withdraw an unfulfilled contract. */
async function cancelContract(req, res) {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid contract id." });
  const contract = await ForwardContract.findOneAndUpdate({ _id: id, buyer: req.userId, status: "open" }, { $set: { status: "cancelled" } }, { new: true });
  if (!contract) return res.status(404).json({ success: false, message: "Contract not found, not yours, or already closed." });
  return res.status(200).json({ success: true, message: "Contract cancelled.", data: contract });
}

module.exports = { createContract, listContracts, getMyContracts, getMyCommitments, expressInterest, confirmCommitment, cancelContract };
