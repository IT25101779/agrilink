const mongoose = require("mongoose");
const DemandRequest = require("../models/DemandRequest");

function isValidId(id) {
  return typeof id === "string" && mongoose.isValidObjectId(id);
}

function firstName(fullName) {
  return String(fullName || "Farmer").trim().split(/\s+/)[0];
}

function escapeRegex(text) {
  return String(text).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Open requests whose "needed by" date has passed become "expired". */
async function expireStaleRequests() {
  await DemandRequest.updateMany({ status: "open", neededBy: { $lt: new Date() } }, { $set: { status: "expired" } });
}

function buyerLabel(buyer) {
  if (!buyer) return "Buyer";
  return (buyer.buyerProfile && buyer.buyerProfile.companyName) || buyer.fullName || "Buyer";
}

/**
 * What a FARMER sees: the request itself, how many offers it has (not the
 * other farmers' prices), and the farmer's own offer if there is one. The
 * buyer's phone number is revealed only once THIS farmer's offer is accepted.
 */
function shapeForFarmer(request, userId) {
  const plain = request.toObject ? request.toObject() : request;
  const mine = (plain.offers || []).filter((o) => String(o.farmer) === String(userId)).pop();
  return {
    _id: plain._id,
    cropType: plain.cropType,
    quantityKg: plain.quantityKg,
    remainingKg: Math.max(0, plain.quantityKg - plain.fulfilledKg),
    maxPricePerKg: plain.maxPricePerKg,
    neededBy: plain.neededBy,
    district: plain.district,
    note: plain.note,
    status: plain.status,
    buyerName: buyerLabel(plain.buyer),
    offersCount: (plain.offers || []).filter((o) => ["offered", "accepted"].includes(o.status)).length,
    myOffer: mine
      ? {
          _id: mine._id,
          quantityKg: mine.quantityKg,
          pricePerKg: mine.pricePerKg,
          message: mine.message,
          status: mine.status,
          acceptedKg: mine.acceptedKg,
          buyerPhone: mine.status === "accepted" && plain.buyer ? plain.buyer.phone : null,
        }
      : null,
  };
}

/**
 * What the BUYER sees for their own request: every offer, with the farmer's
 * first name, district and credit score (a trust signal). The farmer's phone
 * number appears only for offers the buyer has accepted.
 */
function shapeForBuyer(request) {
  const plain = request.toObject ? request.toObject() : request;
  return {
    _id: plain._id,
    cropType: plain.cropType,
    quantityKg: plain.quantityKg,
    fulfilledKg: plain.fulfilledKg,
    remainingKg: Math.max(0, plain.quantityKg - plain.fulfilledKg),
    maxPricePerKg: plain.maxPricePerKg,
    neededBy: plain.neededBy,
    district: plain.district,
    note: plain.note,
    status: plain.status,
    createdAt: plain.createdAt,
    offers: (plain.offers || []).map((o) => ({
      _id: o._id,
      farmerName: firstName(o.farmer && o.farmer.fullName),
      district: o.farmer && o.farmer.farmerProfile ? o.farmer.farmerProfile.district : "",
      creditScore: o.farmer && o.farmer.farmerProfile ? o.farmer.farmerProfile.creditScore : null,
      quantityKg: o.quantityKg,
      pricePerKg: o.pricePerKg,
      message: o.message,
      status: o.status,
      acceptedKg: o.acceptedKg,
      createdAt: o.createdAt,
      farmerPhone: o.status === "accepted" && o.farmer ? o.farmer.phone : null,
    })),
  };
}

const POPULATE_FOR_FARMER = [{ path: "buyer", select: "fullName phone buyerProfile.companyName" }];
const POPULATE_FOR_BUYER = [{ path: "offers.farmer", select: "fullName phone farmerProfile.district farmerProfile.creditScore" }];

/**
 * POST /api/demand   (buyer)
 * Body: { cropType, quantityKg, maxPricePerKg, neededBy, district?, note? }
 */
async function createRequest(req, res) {
  try {
    const { cropType, quantityKg, maxPricePerKg, neededBy, district, note } = req.body;

    const qty = Number(quantityKg);
    const maxPrice = Number(maxPricePerKg);
    const needed = new Date(neededBy);

    if (!cropType || typeof cropType !== "string" || !cropType.trim()) {
      return res.status(400).json({ success: false, message: "cropType is required." });
    }
    if (!Number.isFinite(qty) || qty < 1) {
      return res.status(400).json({ success: false, message: "quantityKg must be at least 1." });
    }
    if (!Number.isFinite(maxPrice) || maxPrice < 1) {
      return res.status(400).json({ success: false, message: "maxPricePerKg must be a positive number." });
    }
    if (Number.isNaN(needed.getTime()) || needed <= new Date()) {
      return res.status(400).json({ success: false, message: "neededBy must be a date in the future." });
    }

    const request = await DemandRequest.create({
      buyer: req.userId,
      cropType: cropType.trim(),
      quantityKg: qty,
      maxPricePerKg: maxPrice,
      neededBy: needed,
      district: district ? String(district).trim() : "",
      note: note ? String(note).slice(0, 300) : "",
    });

    const saved = await DemandRequest.findById(request._id).populate(POPULATE_FOR_BUYER);
    return res.status(201).json({ success: true, data: shapeForBuyer(saved) });
  } catch (error) {
    console.error("createRequest error:", error);
    return res.status(500).json({ success: false, message: "Failed to post the request." });
  }
}

/**
 * GET /api/demand?cropType=&district=&mine=true
 *  - mine=true : the logged-in BUYER's own requests (all statuses, with offers)
 *  - otherwise : open requests for farmers to browse
 */
async function listRequests(req, res) {
  try {
    await expireStaleRequests();
    const { cropType, district, mine } = req.query;

    if (mine === "true") {
      const requests = await DemandRequest.find({ buyer: req.userId }).populate(POPULATE_FOR_BUYER).sort({ createdAt: -1 }).limit(100);
      return res.status(200).json({ success: true, count: requests.length, data: requests.map(shapeForBuyer) });
    }

    const filter = { status: "open" };
    if (cropType) filter.cropType = new RegExp(`^${escapeRegex(cropType)}$`, "i");
    if (district) filter.$or = [{ district: String(district) }, { district: "" }];

    const requests = await DemandRequest.find(filter).populate(POPULATE_FOR_FARMER).sort({ neededBy: 1 }).limit(100);
    return res.status(200).json({ success: true, count: requests.length, data: requests.map((r) => shapeForFarmer(r, req.userId)) });
  } catch (error) {
    console.error("listRequests error:", error);
    return res.status(500).json({ success: false, message: "Failed to load requests." });
  }
}

/**
 * Writes a new offers list (plus any other fields) ONLY if nobody else has
 * changed this request since we read it. Returns the updated request, or
 * null if someone got there first.
 */
async function writeWithLock(request, { offers, set = {} }) {
  return DemandRequest.findOneAndUpdate(
    { _id: request._id, revision: request.revision },
    { $set: { offers, ...set }, $inc: { revision: 1 } },
    { new: true }
  );
}

function plainOffers(request) {
  return request.toObject().offers;
}

const CHANGED_MESSAGE = "This request just changed. Please refresh and try again.";

/**
 * POST /api/demand/:id/offers   (farmer)
 * Body: { quantityKg, pricePerKg, message? }
 * A farmer can have only one live offer per request.
 */
async function makeOffer(req, res) {
  try {
    const { id } = req.params;
    const qty = Number(req.body.quantityKg);
    const price = Number(req.body.pricePerKg);
    const message = req.body.message ? String(req.body.message).slice(0, 300) : "";

    if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid request id." });
    if (!Number.isFinite(qty) || qty < 1) return res.status(400).json({ success: false, message: "quantityKg must be at least 1." });
    if (!Number.isFinite(price) || price < 1) return res.status(400).json({ success: false, message: "pricePerKg must be a positive number." });

    const request = await DemandRequest.findById(id);
    if (!request) return res.status(404).json({ success: false, message: "Request not found." });
    if (request.status !== "open" || request.neededBy < new Date()) {
      return res.status(409).json({ success: false, message: "This request is no longer open." });
    }
    if (price > request.maxPricePerKg) {
      return res.status(400).json({ success: false, message: `The buyer's maximum price is LKR ${request.maxPricePerKg}/kg. Please offer at or below it.` });
    }
    const remaining = request.quantityKg - request.fulfilledKg;
    if (qty > remaining) {
      return res.status(400).json({ success: false, message: `Only ${remaining} kg is still needed. Please offer ${remaining} kg or less.` });
    }
    const alreadyOffered = request.offers.some((o) => String(o.farmer) === String(req.userId) && ["offered", "accepted"].includes(o.status));
    if (alreadyOffered) {
      return res.status(409).json({ success: false, message: "You already have an offer on this request. Withdraw it first to make a new one." });
    }

    const updated = await DemandRequest.findOneAndUpdate(
      { _id: id, status: "open", revision: request.revision },
      { $push: { offers: { farmer: req.userId, quantityKg: qty, pricePerKg: price, message } }, $inc: { revision: 1 } },
      { new: true }
    );
    if (!updated) return res.status(409).json({ success: false, message: CHANGED_MESSAGE });

    const saved = await DemandRequest.findById(id).populate(POPULATE_FOR_FARMER);
    return res.status(201).json({ success: true, message: "Offer sent to the buyer.", data: shapeForFarmer(saved, req.userId) });
  } catch (error) {
    console.error("makeOffer error:", error);
    return res.status(500).json({ success: false, message: "Failed to send the offer." });
  }
}

/**
 * POST /api/demand/:id/offers/:offerId/withdraw   (farmer)
 */
async function withdrawOffer(req, res) {
  try {
    const { id, offerId } = req.params;
    if (!isValidId(id) || !isValidId(offerId)) return res.status(400).json({ success: false, message: "Invalid id." });

    const request = await DemandRequest.findById(id);
    if (!request) return res.status(404).json({ success: false, message: "Request not found." });

    const offers = plainOffers(request);
    const offer = offers.find((o) => String(o._id) === offerId && String(o.farmer) === String(req.userId) && o.status === "offered");
    if (!offer) {
      return res.status(409).json({ success: false, message: "That offer can't be withdrawn (it may already be accepted or removed)." });
    }
    offer.status = "withdrawn";

    const updated = await writeWithLock(request, { offers });
    if (!updated) return res.status(409).json({ success: false, message: CHANGED_MESSAGE });
    return res.status(200).json({ success: true, message: "Offer withdrawn." });
  } catch (error) {
    console.error("withdrawOffer error:", error);
    return res.status(500).json({ success: false, message: "Failed to withdraw the offer." });
  }
}

/**
 * POST /api/demand/:id/offers/:offerId/accept   (buyer who owns the request)
 * The accepted quantity is capped at what is still needed. When the request
 * is fully covered it becomes "fulfilled" and any offers still waiting are declined.
 */
async function acceptOffer(req, res) {
  try {
    const { id, offerId } = req.params;
    if (!isValidId(id) || !isValidId(offerId)) return res.status(400).json({ success: false, message: "Invalid id." });

    const request = await DemandRequest.findById(id);
    if (!request) return res.status(404).json({ success: false, message: "Request not found." });
    if (String(request.buyer) !== String(req.userId)) {
      return res.status(403).json({ success: false, message: "Only the buyer who posted this request can accept offers." });
    }
    if (request.status !== "open") {
      return res.status(409).json({ success: false, message: `This request is no longer open (status: ${request.status}).` });
    }

    const offers = plainOffers(request);
    const offer = offers.find((o) => String(o._id) === offerId);
    if (!offer) return res.status(404).json({ success: false, message: "Offer not found." });
    if (offer.status !== "offered") {
      return res.status(409).json({ success: false, message: `This offer can't be accepted (status: ${offer.status}).` });
    }

    const remaining = request.quantityKg - request.fulfilledKg;
    if (remaining <= 0) return res.status(409).json({ success: false, message: "This request is already fully covered." });

    const acceptedKg = Math.min(offer.quantityKg, remaining);
    const newFulfilled = request.fulfilledKg + acceptedKg;
    const becomesFulfilled = newFulfilled >= request.quantityKg;

    offer.status = "accepted";
    offer.acceptedKg = acceptedKg;
    if (becomesFulfilled) {
      offers.forEach((o) => {
        if (o.status === "offered") o.status = "declined";
      });
    }

    const updated = await writeWithLock(request, {
      offers,
      set: { fulfilledKg: newFulfilled, status: becomesFulfilled ? "fulfilled" : "open" },
    });
    if (!updated) return res.status(409).json({ success: false, message: CHANGED_MESSAGE });

    const saved = await DemandRequest.findById(id).populate(POPULATE_FOR_BUYER);
    return res.status(200).json({
      success: true,
      message: becomesFulfilled ? "Offer accepted — your request is now fully covered." : `Offer accepted for ${acceptedKg} kg.`,
      data: shapeForBuyer(saved),
    });
  } catch (error) {
    console.error("acceptOffer error:", error);
    return res.status(500).json({ success: false, message: "Failed to accept the offer." });
  }
}

/**
 * POST /api/demand/:id/offers/:offerId/decline   (buyer who owns the request)
 */
async function declineOffer(req, res) {
  try {
    const { id, offerId } = req.params;
    if (!isValidId(id) || !isValidId(offerId)) return res.status(400).json({ success: false, message: "Invalid id." });

    const request = await DemandRequest.findById(id);
    if (!request) return res.status(404).json({ success: false, message: "Request not found." });
    if (String(request.buyer) !== String(req.userId)) {
      return res.status(403).json({ success: false, message: "Only the buyer who posted this request can decline offers." });
    }

    const offers = plainOffers(request);
    const offer = offers.find((o) => String(o._id) === offerId && o.status === "offered");
    if (!offer) return res.status(409).json({ success: false, message: "That offer can't be declined." });
    offer.status = "declined";

    const updated = await writeWithLock(request, { offers });
    if (!updated) return res.status(409).json({ success: false, message: CHANGED_MESSAGE });
    return res.status(200).json({ success: true, message: "Offer declined." });
  } catch (error) {
    console.error("declineOffer error:", error);
    return res.status(500).json({ success: false, message: "Failed to decline the offer." });
  }
}

/**
 * POST /api/demand/:id/cancel   (buyer who owns the request)
 */
async function cancelRequest(req, res) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid request id." });

    const updated = await DemandRequest.findOneAndUpdate(
      { _id: id, buyer: req.userId, status: "open" },
      { $set: { status: "cancelled" } },
      { new: true }
    );
    if (!updated) return res.status(409).json({ success: false, message: "This request can't be cancelled." });
    return res.status(200).json({ success: true, message: "Request cancelled." });
  } catch (error) {
    console.error("cancelRequest error:", error);
    return res.status(500).json({ success: false, message: "Failed to cancel the request." });
  }
}

module.exports = { createRequest, listRequests, makeOffer, withdrawOffer, acceptOffer, declineOffer, cancelRequest };
