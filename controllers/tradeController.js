const crypto = require("crypto");
const mongoose = require("mongoose");
const TradeOrder = require("../models/TradeOrder");
const MarketplaceListing = require("../models/MarketplaceListing");
const Rating = require("../models/Rating");
const LedgerEntry = require("../models/LedgerEntry");
const User = require("../models/User");
const { computeFreshness } = require("../utils/shelfLife");
const { computeTrust } = require("../utils/trust");
const { notifyFarmer } = require("../utils/notify");
const PaymentProfile = require("../models/PaymentProfile");
const Photo = require("../models/Photo");
const Block = require("../models/Block");

const MAX_CODE_ATTEMPTS = 5;

function fail(res, status, message, code) {
  return res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
}

function secret() {
  return process.env.ORDER_CODE_SECRET || process.env.JWT_SECRET || "agrilink-orders";
}

/** The 4-digit delivery code is derived, never stored, and shown only to the buyer. */
function deliveryCodeFor(orderId, salt) {
  const h = crypto.createHmac("sha256", secret()).update(`${orderId}|${salt}`).digest();
  return String(h.readUInt32BE(0) % 10000).padStart(4, "0");
}

function addEvent(order, status, by) {
  order.events.push({ status, by, at: new Date() });
}

async function loadOrder(req, res, roleNeeded) {
  if (!mongoose.isValidObjectId(req.params.id)) { fail(res, 400, "Invalid order."); return null; }
  const order = await TradeOrder.findById(req.params.id).select("+delivery.codeSalt");
  if (!order) { fail(res, 404, "Order not found."); return null; }
  const isFarmer = String(order.farmer) === String(req.userId);
  const isBuyer = String(order.buyer) === String(req.userId);
  if (!isFarmer && !isBuyer) { fail(res, 403, "This is not your order."); return null; }
  if (roleNeeded === "farmer" && !isFarmer) { fail(res, 403, "Only the farmer can do this."); return null; }
  if (roleNeeded === "buyer" && !isBuyer) { fail(res, 403, "Only the buyer can do this."); return null; }
  return { order, isFarmer, isBuyer };
}

async function releaseListing(order) {
  await MarketplaceListing.updateOne({ _id: order.listing, status: "reserved" }, { $set: { status: "listed" }, $unset: { orderedBy: 1, agreedPricePerKg: 1 } });
}

async function shapeOrders(orders, viewerId) {
  const ids = orders.flatMap((o) => [o.farmer._id || o.farmer, o.buyer._id || o.buyer]);
  const trust = await computeTrust(ids);
  const farmerIds = [...new Set(orders.map((o) => String(o.farmer._id || o.farmer)))];
  const [payProfiles, qrPhotos] = await Promise.all([PaymentProfile.find({ user: { $in: farmerIds } }).lean(), Photo.find({ owner: { $in: farmerIds }, purpose: "payment_qr" }).select("owner").lean()]);
  const payOf = new Map(payProfiles.map((p) => [String(p.user), p.instructions]));
  const qrOf = new Map(qrPhotos.map((p) => [String(p.owner), String(p._id)]));
  const myRatings = await Rating.find({ order: { $in: orders.map((o) => o._id) }, rater: viewerId }).select("order stars").lean();
  const ratedMap = new Map(myRatings.map((r) => [String(r.order), r.stars]));
  return orders.map((o) => {
    const isFarmer = String(o.farmer._id || o.farmer) === String(viewerId);
    const farmer = o.farmer, buyer = o.buyer;
    const other = isFarmer ? buyer : farmer;
    const contactUnlocked = ["accepted", "dispatched", "delivered", "paid"].includes(o.status);
    const data = {
      id: String(o._id),
      listingId: String(o.listing),
      role: isFarmer ? "farmer" : "buyer",
      cropType: o.cropType,
      quantityKg: o.quantityKg,
      pricePerKg: o.pricePerKg,
      totalLkr: o.totalLkr,
      status: o.status,
      delivery: { method: o.delivery && o.delivery.method, dispatchedAt: o.delivery && o.delivery.dispatchedAt, deliveredAt: o.delivery && o.delivery.deliveredAt, codeLocked: (o.delivery && o.delivery.codeAttempts >= MAX_CODE_ATTEMPTS) || false },
      payment: o.payment || {},
      cancelReason: o.cancelReason,
      cancelledBy: o.cancelledBy,
      events: o.events,
      createdAt: o.createdAt,
      other: {
        id: String(other._id),
        name: isFarmer ? (other.buyerProfile && other.buyerProfile.companyName) || other.fullName : other.fullName,
        district: other.farmerProfile && other.farmerProfile.district,
        phone: contactUnlocked ? other.phone : undefined,
        hasAvatar: Boolean(other.avatarUpdatedAt),
        trust: trust[String(other._id)],
      },
      canRate: ["delivered", "paid"].includes(o.status) && !ratedMap.has(String(o._id)),
      myRating: ratedMap.get(String(o._id)) || null,
    };
    // Only the BUYER ever sees the delivery code, and only while the goods are on the way.
    // The buyer sees HOW to pay the farmer once the goods are on the way.
    if (!isFarmer && ["dispatched", "delivered"].includes(o.status)) {
      const fid = String(o.farmer._id || o.farmer);
      data.farmerPayment = { instructions: payOf.get(fid) || "", qrPhotoId: qrOf.get(fid) || null };
    }
    if (!isFarmer && o.status === "dispatched" && o.delivery && o.delivery.codeSalt) data.deliveryCode = deliveryCodeFor(o._id, o.delivery.codeSalt);
    return data;
  });
}

/** POST /api/orders { listingId } — a buyer orders a whole listing. */
async function placeOrder(req, res) {
  try {
    if (req.userRole !== "buyer") return fail(res, 403, "Only buyers can place orders.");
    if (!mongoose.isValidObjectId(String((req.body || {}).listingId))) return fail(res, 400, "Choose a listing.");
    const listing = await MarketplaceListing.findById(req.body.listingId);
    if (!listing || listing.status !== "listed") return fail(res, 409, "This listing is no longer available.", "unavailable");
    if (String(listing.farmer) === String(req.userId)) return fail(res, 400, "You can't order your own listing.");
    if (await Block.exists({ $or: [{ blocker: listing.farmer, blocked: req.userId }, { blocker: req.userId, blocked: listing.farmer }] })) return fail(res, 403, "You can't order from this seller.", "blocked");
    const freshness = computeFreshness(listing);
    if (freshness.expired) return fail(res, 409, "This produce is past its freshness window.", "expired");

    // Reserve first (atomic), so two buyers can't both get it.
    const price = freshness.effectivePricePerKg;
    const reserved = await MarketplaceListing.findOneAndUpdate({ _id: listing._id, status: "listed" }, { $set: { status: "reserved", orderedBy: req.userId, agreedPricePerKg: price } }, { new: true });
    if (!reserved) return fail(res, 409, "Someone else just ordered this.", "unavailable");

    const order = await TradeOrder.create({
      listing: listing._id, farmer: listing.farmer, buyer: req.userId, cropType: listing.cropType,
      quantityKg: listing.quantityKg, pricePerKg: price, totalLkr: Math.round(price * listing.quantityKg),
      events: [{ status: "placed", by: "buyer" }],
    });
    const buyer = await User.findById(req.userId).select("fullName buyerProfile");
    await notifyFarmer(listing.farmer, { type: "order_update", cropType: listing.cropType, dedupeKey: `order-placed-${order._id}`, title: `New order for your ${listing.cropType}`, message: `${(buyer.buyerProfile && buyer.buyerProfile.companyName) || buyer.fullName} wants ${listing.quantityKg} kg at LKR ${price}/kg. Open Orders to accept.` });
    return res.status(201).json({ success: true, data: { id: String(order._id), status: order.status, totalLkr: order.totalLkr } });
  } catch (error) {
    console.error("placeOrder error:", error);
    return fail(res, 500, "Failed to place the order.");
  }
}

/** GET /api/orders/mine */
async function myOrders(req, res) {
  try {
    const filter = req.userRole === "buyer" ? { buyer: req.userId } : { farmer: req.userId };
    const orders = await TradeOrder.find(filter).sort({ createdAt: -1 }).limit(100).populate("farmer", "fullName phone farmerProfile.district avatarUpdatedAt").populate("buyer", "fullName phone buyerProfile avatarUpdatedAt").select("+delivery.codeSalt");
    return res.status(200).json({ success: true, data: await shapeOrders(orders, req.userId) });
  } catch (error) {
    console.error("myOrders error:", error);
    return fail(res, 500, "Failed to load orders.");
  }
}

async function accept(req, res) {
  try {
    const ctx = await loadOrder(req, res, "farmer"); if (!ctx) return;
    const { order } = ctx;
    if (order.status !== "placed") return fail(res, 409, "This order can't be accepted now.");
    order.status = "accepted"; addEvent(order, "accepted", "farmer"); await order.save();
    return res.status(200).json({ success: true, status: order.status });
  } catch (error) { console.error("accept error:", error); return fail(res, 500, "Failed."); }
}

/** POST /api/orders/:id/cancel { reason } — either side, but only before the goods leave. */
async function cancel(req, res) {
  try {
    const ctx = await loadOrder(req, res); if (!ctx) return;
    const { order, isFarmer } = ctx;
    // A buyer may also refuse goods that are out for delivery, but only for a quality problem.
    const qualityRefusal = !isFarmer && order.status === "dispatched" && (req.body || {}).qualityRejected === true;
    if (!["placed", "accepted"].includes(order.status) && !qualityRefusal) return fail(res, 409, "This order can no longer be cancelled.");
    order.status = "cancelled"; order.cancelledBy = isFarmer ? "farmer" : "buyer";
    order.cancelReason = String((req.body || {}).reason || "").trim().slice(0, 200);
    addEvent(order, "cancelled", order.cancelledBy); await order.save();
    await releaseListing(order);
    return res.status(200).json({ success: true, status: order.status });
  } catch (error) { console.error("cancel error:", error); return fail(res, 500, "Failed."); }
}

/** POST /api/orders/:id/dispatch { method: "truck"|"self"|"pickup", returnTripId? } */
async function dispatch(req, res) {
  try {
    const ctx = await loadOrder(req, res, "farmer"); if (!ctx) return;
    const { order } = ctx;
    if (order.status !== "accepted") return fail(res, 409, "Accept the order first.");
    const method = (req.body || {}).method;
    if (!["truck", "self", "pickup"].includes(method)) return fail(res, 400, "Choose how it will be delivered.");
    order.status = "dispatched";
    order.delivery.method = method;
    order.delivery.dispatchedAt = new Date();
    order.delivery.codeSalt = crypto.randomBytes(8).toString("hex");
    order.delivery.codeAttempts = 0;
    if (method === "truck" && mongoose.isValidObjectId(String(req.body.returnTripId))) order.delivery.returnTrip = req.body.returnTripId;
    addEvent(order, "dispatched", "farmer"); await order.save();
    return res.status(200).json({ success: true, status: order.status });
  } catch (error) { console.error("dispatch error:", error); return fail(res, 500, "Failed."); }
}

/** POST /api/orders/:id/new-code — buyer asks for a fresh code (e.g. after too many wrong tries). */
async function newCode(req, res) {
  try {
    const ctx = await loadOrder(req, res, "buyer"); if (!ctx) return;
    const { order } = ctx;
    if (order.status !== "dispatched") return fail(res, 409, "There is no delivery in progress.");
    order.delivery.codeSalt = crypto.randomBytes(8).toString("hex"); order.delivery.codeAttempts = 0; await order.save();
    return res.status(200).json({ success: true });
  } catch (error) { console.error("newCode error:", error); return fail(res, 500, "Failed."); }
}

/** POST /api/orders/:id/deliver { code } — the person delivering types the code the buyer reads out. */
async function deliver(req, res) {
  try {
    const ctx = await loadOrder(req, res, "farmer"); if (!ctx) return;
    const { order } = ctx;
    if (order.status !== "dispatched") return fail(res, 409, "This order is not out for delivery.");
    if (order.delivery.codeAttempts >= MAX_CODE_ATTEMPTS) return fail(res, 423, "Too many wrong codes. Ask the buyer for a new code.", "locked");
    const supplied = String((req.body || {}).code || "").trim();
    const expected = deliveryCodeFor(order._id, order.delivery.codeSalt);
    const match = /^\d{4}$/.test(supplied) && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    if (!match) {
      order.delivery.codeAttempts += 1; await order.save();
      return fail(res, 400, `Wrong code. ${Math.max(0, MAX_CODE_ATTEMPTS - order.delivery.codeAttempts)} tries left.`, "wrong_code");
    }
    order.status = "delivered"; order.delivery.deliveredAt = new Date(); addEvent(order, "delivered", "farmer"); await order.save();
    return res.status(200).json({ success: true, status: order.status });
  } catch (error) { console.error("deliver error:", error); return fail(res, 500, "Failed."); }
}

/** POST /api/orders/:id/pay { method } — the buyer says they have paid. */
async function pay(req, res) {
  try {
    const ctx = await loadOrder(req, res, "buyer"); if (!ctx) return;
    const { order } = ctx;
    if (order.status !== "delivered") return fail(res, 409, "You can mark payment after the delivery is confirmed.");
    const method = (req.body || {}).method;
    if (!["cash", "bank_transfer", "mobile_wallet"].includes(method)) return fail(res, 400, "Choose how you paid.");
    order.payment.method = method; order.payment.buyerMarkedAt = new Date(); await order.save();
    await notifyFarmer(order.farmer, { type: "order_update", cropType: order.cropType, dedupeKey: `order-paid-${order._id}`, title: "Payment sent", message: `The buyer says they paid LKR ${order.totalLkr} for your ${order.cropType}. Confirm once you have received it.` });
    return res.status(200).json({ success: true });
  } catch (error) { console.error("pay error:", error); return fail(res, 500, "Failed."); }
}

/** POST /api/orders/:id/confirm-payment — the farmer confirms the money arrived. Closes the sale. */
async function confirmPayment(req, res) {
  try {
    const ctx = await loadOrder(req, res, "farmer"); if (!ctx) return;
    const { order } = ctx;
    if (order.status !== "delivered" || !order.payment.buyerMarkedAt) return fail(res, 409, "Wait for the buyer to mark the payment first.");
    order.status = "paid"; order.payment.farmerConfirmedAt = new Date(); addEvent(order, "paid", "farmer"); await order.save();
    await MarketplaceListing.updateOne({ _id: order.listing }, { $set: { status: "sold", soldAt: new Date(), agreedPricePerKg: order.pricePerKg } });
    // A sale also goes straight into the farmer's money book.
    await LedgerEntry.create({ farmer: order.farmer, cropType: order.cropType, type: "income", category: "sale", amountLkr: Math.max(1, order.totalLkr), note: `AgriLink order — ${order.quantityKg} kg`, date: new Date(), orderRef: order._id });
    await notifyFarmer(order.farmer, { type: "rating_request", cropType: order.cropType, dedupeKey: `rate-${order._id}`, title: "How was the buyer?", message: "Sale complete! Please rate the buyer — it helps every farmer choose safely." });
    return res.status(200).json({ success: true, status: order.status });
  } catch (error) { console.error("confirmPayment error:", error); return fail(res, 500, "Failed."); }
}

module.exports = { placeOrder, myOrders, accept, cancel, dispatch, newCode, deliver, pay, confirmPayment, deliveryCodeFor };
