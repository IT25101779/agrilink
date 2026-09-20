const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const t = require("../controllers/tradeController");

router.use(protect);
router.post("/", t.placeOrder);
router.get("/mine", t.myOrders);
router.post("/:id/accept", t.accept);
router.post("/:id/cancel", t.cancel);
router.post("/:id/dispatch", t.dispatch);
router.post("/:id/new-code", t.newCode);
router.post("/:id/deliver", t.deliver);
router.post("/:id/pay", t.pay);
router.post("/:id/confirm-payment", t.confirmPayment);

module.exports = router;
