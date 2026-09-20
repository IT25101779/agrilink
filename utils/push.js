const DeviceToken = require("../models/DeviceToken");

let sender = null; // (tokens, { title, body }) => Promise<void>
function setSender(fn) { sender = fn; }

/** Uses firebase-admin when it is installed AND FIREBASE_SERVICE_ACCOUNT (the JSON key) is set. Otherwise push is simply off. */
function defaultSender() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return null;
  try {
    const admin = require("firebase-admin");
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    return async (tokens, message) => { await admin.messaging().sendEachForMulticast({ tokens, notification: { title: message.title, body: message.body }, android: { priority: "high" } }); };
  } catch (_) {
    return null;
  }
}

async function sendPush(userId, message) {
  try {
    const tokens = (await DeviceToken.find({ user: userId }).select("token").lean()).map((t) => t.token);
    if (!tokens.length) return { status: "skipped", detail: "no devices" };
    const send = sender || defaultSender();
    if (!send) return { status: "skipped", detail: "push not configured" };
    await send(tokens, message);
    return { status: "sent", devices: tokens.length };
  } catch (error) {
    return { status: "failed", detail: error.message };
  }
}

module.exports = { sendPush, setSender };
