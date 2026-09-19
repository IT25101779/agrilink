const mongoose = require("mongoose");
const GroupLot = require("../models/GroupLot");
const User = require("../models/User");

const MAX_JOIN_RETRIES = 3;
const MIN_TARGET_KG = 50;
const MAX_TARGET_KG = 50000;

function isValidId(id) {
  return typeof id === "string" && mongoose.isValidObjectId(id);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function firstName(fullName) {
  return String(fullName || "Farmer").trim().split(/\s+/)[0];
}

/** Lots whose closing time has passed and are still "open" become "expired". */
async function expireStaleLots() {
  await GroupLot.updateMany({ status: "open", closesAt: { $lt: new Date() } }, { $set: { status: "expired" } });
}

/**
 * Turns a lot into the shape the apps display, adding the calculated
 * fields (kg still needed, % filled, "is this me?"). Only first names of
 * fellow members are shared.
 */
function shapeLot(lot, userId) {
  const plain = lot.toObject ? lot.toObject() : lot;
  const me = String(userId);
  const creatorId = plain.createdBy && plain.createdBy._id ? String(plain.createdBy._id) : String(plain.createdBy);

  const members = (plain.members || []).map((m) => {
    const farmerId = m.farmer && m.farmer._id ? String(m.farmer._id) : String(m.farmer);
    return {
      name: firstName(m.farmer && m.farmer.fullName),
      quantityKg: m.quantityKg,
      isMe: farmerId === me,
    };
  });
  const mine = members.find((m) => m.isMe);

  return {
    _id: plain._id,
    cropType: plain.cropType,
    district: plain.district,
    targetKg: plain.targetKg,
    committedKg: plain.committedKg,
    remainingKg: Math.max(0, plain.targetKg - plain.committedKg),
    progressPercent: Math.min(100, Math.round((plain.committedKg / plain.targetKg) * 100)),
    pricePerKg: plain.pricePerKg,
    totalValueLkr: round2(plain.targetKg * plain.pricePerKg),
    pickupNote: plain.pickupNote,
    status: plain.status,
    closesAt: plain.closesAt,
    createdAt: plain.createdAt,
    organizer: firstName(plain.createdBy && plain.createdBy.fullName),
    isOrganizer: creatorId === me,
    memberCount: members.length,
    members,
    isMember: Boolean(mine),
    myQuantityKg: mine ? mine.quantityKg : 0,
  };
}

const POPULATE = [
  { path: "createdBy", select: "fullName" },
  { path: "members.farmer", select: "fullName" },
];

/**
 * POST /api/group-lots   (farmer)
 * Body: { cropType, targetKg, pricePerKg, quantityKg, closesInDays?, pickupNote?, district? }
 * The organiser's own contribution (quantityKg) is added as the first member.
 */
async function createLot(req, res) {
  try {
    const { cropType, targetKg, pricePerKg, quantityKg, closesInDays, pickupNote } = req.body;

    const target = Number(targetKg);
    const price = Number(pricePerKg);
    const own = Number(quantityKg);
    const days = closesInDays === undefined ? 5 : Number(closesInDays);

    if (!cropType || typeof cropType !== "string" || !cropType.trim()) {
      return res.status(400).json({ success: false, message: "cropType is required." });
    }
    if (!Number.isFinite(target) || target < MIN_TARGET_KG || target > MAX_TARGET_KG) {
      return res.status(400).json({ success: false, message: `targetKg must be between ${MIN_TARGET_KG} and ${MAX_TARGET_KG} kg.` });
    }
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ success: false, message: "pricePerKg must be a positive number." });
    }
    if (!Number.isFinite(own) || own < 1 || own > target) {
      return res.status(400).json({ success: false, message: "Your own quantity must be at least 1 kg and no more than the lot target." });
    }
    if (!Number.isFinite(days) || days < 1 || days > 21) {
      return res.status(400).json({ success: false, message: "closesInDays must be between 1 and 21." });
    }

    const organiser = await User.findById(req.userId).select("farmerProfile.district");
    const district = (organiser && organiser.farmerProfile && organiser.farmerProfile.district) || String(req.body.district || "").trim();
    if (!district) {
      return res.status(400).json({ success: false, message: "Your district is needed to create a group lot. Please set it in your profile." });
    }

    const status = own >= target ? "full" : "open";
    const lot = await GroupLot.create({
      cropType: cropType.trim(),
      district,
      targetKg: target,
      pricePerKg: price,
      pickupNote: pickupNote ? String(pickupNote).slice(0, 200) : "",
      createdBy: req.userId,
      members: [{ farmer: req.userId, quantityKg: own }],
      committedKg: own,
      status,
      closesAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    });

    const saved = await GroupLot.findById(lot._id).populate(POPULATE);
    return res.status(201).json({ success: true, data: shapeLot(saved, req.userId) });
  } catch (error) {
    console.error("createLot error:", error);
    return res.status(500).json({ success: false, message: "Failed to create the group lot." });
  }
}

/**
 * GET /api/group-lots?district=&cropType=&status=open|full|claimed|all&mine=true
 * Default: open and full lots (the ones that still need action).
 */
async function listLots(req, res) {
  try {
    await expireStaleLots();

    const { district, cropType, status, mine } = req.query;
    const filter = {};

    if (status === "all") {
      // no status filter
    } else if (status) {
      filter.status = status;
    } else {
      filter.status = { $in: ["open", "full"] };
    }
    if (district) filter.district = String(district);
    if (cropType) filter.cropType = new RegExp(`^${String(cropType).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    if (mine === "true") filter["members.farmer"] = req.userId;
    if (req.query.claimedByMe === "true") filter.claimedBy = req.userId;

    const lots = await GroupLot.find(filter).populate(POPULATE).sort({ createdAt: -1 }).limit(100);
    return res.status(200).json({ success: true, count: lots.length, data: lots.map((l) => shapeLot(l, req.userId)) });
  } catch (error) {
    console.error("listLots error:", error);
    return res.status(500).json({ success: false, message: "Failed to load group lots." });
  }
}

/**
 * POST /api/group-lots/:id/join   (farmer)   Body: { quantityKg }
 *
 * The contribution is capped at what the lot still needs. Done as a
 * "write only if nothing changed since I read it" update, retried a few
 * times, so two farmers joining at the same instant can never push the
 * lot over its target.
 */
async function joinLot(req, res) {
  try {
    const { id } = req.params;
    const requested = Number(req.body.quantityKg);

    if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid lot id." });
    if (!Number.isFinite(requested) || requested < 1) {
      return res.status(400).json({ success: false, message: "quantityKg must be at least 1 kg." });
    }

    const userObjectId = new mongoose.Types.ObjectId(req.userId);

    for (let attempt = 0; attempt < MAX_JOIN_RETRIES; attempt++) {
      const lot = await GroupLot.findById(id);
      if (!lot) return res.status(404).json({ success: false, message: "Group lot not found." });

      if (lot.status === "open" && lot.closesAt < new Date()) {
        await GroupLot.updateOne({ _id: id, status: "open" }, { $set: { status: "expired" } });
        return res.status(409).json({ success: false, message: "This group lot has closed." });
      }
      if (lot.status !== "open") {
        return res.status(409).json({ success: false, message: `This group lot is no longer open (status: ${lot.status}).` });
      }

      const remaining = lot.targetKg - lot.committedKg;
      if (remaining <= 0) return res.status(409).json({ success: false, message: "This group lot is already full." });

      const actual = round2(Math.min(requested, remaining));
      const newCommitted = round2(lot.committedKg + actual);
      const becomesFull = newCommitted >= lot.targetKg;

      // Build the new member list in code, then write it back ONLY if nobody
      // else changed the lot since we read it (committedKg changes on every
      // join/leave, so it doubles as the "nothing changed" check).
      const members = lot.members.map((m) => ({ farmer: m.farmer, quantityKg: m.quantityKg, joinedAt: m.joinedAt }));
      const existing = members.find((m) => String(m.farmer) === String(req.userId));
      if (existing) existing.quantityKg = round2(existing.quantityKg + actual);
      else members.push({ farmer: userObjectId, quantityKg: actual, joinedAt: new Date() });

      const filter = { _id: id, status: "open", committedKg: lot.committedKg };
      const update = { $set: { members, committedKg: newCommitted, status: becomesFull ? "full" : "open" } };
      const options = { new: true };

      const updated = await GroupLot.findOneAndUpdate(filter, update, options);
      if (updated) {
        const saved = await GroupLot.findById(id).populate(POPULATE);
        return res.status(200).json({
          success: true,
          message: becomesFull
            ? "The lot is now full — buyers can claim it."
            : actual < requested
            ? `Only ${actual} kg was still needed, so your contribution was set to ${actual} kg.`
            : "You joined the group lot.",
          data: shapeLot(saved, req.userId),
        });
      }
      // Someone else joined between our read and write — read again and retry.
    }

    return res.status(409).json({ success: false, message: "Many farmers are joining right now. Please try again." });
  } catch (error) {
    console.error("joinLot error:", error);
    return res.status(500).json({ success: false, message: "Failed to join the group lot." });
  }
}

/**
 * POST /api/group-lots/:id/leave   (farmer)
 * Only while the lot is still open, and not for the organiser (who cancels instead).
 */
async function leaveLot(req, res) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid lot id." });

    const lot = await GroupLot.findById(id);
    if (!lot) return res.status(404).json({ success: false, message: "Group lot not found." });
    if (String(lot.createdBy) === String(req.userId)) {
      return res.status(403).json({ success: false, message: "The organiser can't leave their own lot — cancel it instead." });
    }
    if (lot.status !== "open") {
      return res.status(409).json({ success: false, message: "You can only leave a lot while it is still open." });
    }
    const member = lot.members.find((m) => String(m.farmer) === String(req.userId));
    if (!member) return res.status(404).json({ success: false, message: "You are not part of this lot." });

    const remainingMembers = lot.members
      .filter((m) => String(m.farmer) !== String(req.userId))
      .map((m) => ({ farmer: m.farmer, quantityKg: m.quantityKg, joinedAt: m.joinedAt }));

    const updated = await GroupLot.findOneAndUpdate(
      { _id: id, status: "open", committedKg: lot.committedKg },
      { $set: { members: remainingMembers, committedKg: round2(lot.committedKg - member.quantityKg) } },
      { new: true }
    );
    if (!updated) {
      return res.status(409).json({ success: false, message: "The lot just changed. Please refresh and try again." });
    }
    return res.status(200).json({ success: true, message: "You left the group lot." });
  } catch (error) {
    console.error("leaveLot error:", error);
    return res.status(500).json({ success: false, message: "Failed to leave the group lot." });
  }
}

/**
 * POST /api/group-lots/:id/cancel   (organiser)
 * Allowed only while nobody else has joined, so no one's contribution is dropped.
 */
async function cancelLot(req, res) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid lot id." });

    const lot = await GroupLot.findById(id);
    if (!lot) return res.status(404).json({ success: false, message: "Group lot not found." });
    if (String(lot.createdBy) !== String(req.userId)) {
      return res.status(403).json({ success: false, message: "Only the organiser can cancel this lot." });
    }
    if (!["open", "full"].includes(lot.status)) {
      return res.status(409).json({ success: false, message: `This lot can no longer be cancelled (status: ${lot.status}).` });
    }
    if (lot.members.length > 1) {
      return res.status(409).json({ success: false, message: "Other farmers have already joined, so the lot can't be cancelled. It will close automatically if it doesn't fill." });
    }

    const updated = await GroupLot.findOneAndUpdate({ _id: id, status: { $in: ["open", "full"] } }, { $set: { status: "cancelled" } }, { new: true });
    if (!updated) return res.status(409).json({ success: false, message: "The lot just changed. Please refresh." });
    return res.status(200).json({ success: true, message: "Group lot cancelled." });
  } catch (error) {
    console.error("cancelLot error:", error);
    return res.status(500).json({ success: false, message: "Failed to cancel the group lot." });
  }
}

/**
 * POST /api/group-lots/:id/claim   (buyer)
 * A buyer takes a FULL lot. One atomic step, so two buyers can't both claim it.
 * Returns each farmer's share of the total value.
 */
async function claimLot(req, res) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid lot id." });

    const claimed = await GroupLot.findOneAndUpdate(
      { _id: id, status: "full" },
      { $set: { status: "claimed", claimedBy: req.userId, claimedAt: new Date() } },
      { new: true }
    );

    if (!claimed) {
      const lot = await GroupLot.findById(id);
      if (!lot) return res.status(404).json({ success: false, message: "Group lot not found." });
      if (lot.status === "open") {
        return res.status(409).json({ success: false, message: `This lot is not full yet (${lot.committedKg} of ${lot.targetKg} kg).` });
      }
      return res.status(409).json({ success: false, message: `This lot is not available (status: ${lot.status}).` });
    }

    const populated = await GroupLot.findById(id).populate([
      { path: "createdBy", select: "fullName phone" },
      { path: "members.farmer", select: "fullName" },
    ]);

    const shares = populated.members.map((m) => ({
      name: firstName(m.farmer && m.farmer.fullName),
      quantityKg: m.quantityKg,
      amountLkr: round2(m.quantityKg * populated.pricePerKg),
    }));

    return res.status(200).json({
      success: true,
      message: "Lot claimed. Contact the organiser to arrange collection and payment.",
      data: {
        ...shapeLot(populated, req.userId),
        organizerPhone: populated.createdBy ? populated.createdBy.phone : null,
        shares,
        totalValueLkr: round2(shares.reduce((sum, s) => sum + s.amountLkr, 0)),
      },
    });
  } catch (error) {
    console.error("claimLot error:", error);
    return res.status(500).json({ success: false, message: "Failed to claim the group lot." });
  }
}

module.exports = { createLot, listLots, joinLot, leaveLot, cancelLot, claimLot, shapeLot };
