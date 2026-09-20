// Backup -> wipe -> restore round trip on a scratch database: every collection, every document, photos (binary) intact.
const assert = require("assert"); const mongoose = require("mongoose"); const fs = require("fs");
const { backup } = require("./scripts/backup"); const { restore } = require("./scripts/restore");
(async () => {
  const SRC = "mongodb://127.0.0.1:27017/agrilink_bk_src", DST = "mongodb://127.0.0.1:27017/agrilink_bk_dst", DIR = "/tmp/bk_test";
  fs.rmSync(DIR, { recursive: true, force: true });
  await mongoose.connect(SRC); const db = mongoose.connection.db; await db.dropDatabase();
  const uid = new mongoose.Types.ObjectId();
  await db.collection("users").insertMany([{ _id: uid, fullName: "සුනිල් / சுனில்", createdAt: new Date("2026-01-02T03:04:05Z") }, { fullName: "Second" }]);
  await db.collection("photos").insertOne({ owner: uid, data: Buffer.from([137, 80, 78, 71, 0, 255, 1, 2]), size: 8 });
  await db.collection("empty_col").insertOne({ x: 1 }); await db.collection("empty_col").deleteMany({});
  await mongoose.disconnect();
  const summary = await backup(SRC, DIR); assert.equal(summary.users, 2); assert.equal(summary.photos, 1); assert.ok(fs.existsSync(DIR + "/users.json.gz") && fs.existsSync(DIR + "/_summary.json"));
  await mongoose.connect(DST); await mongoose.connection.db.dropDatabase(); await mongoose.connection.db.collection("users").insertOne({ fullName: "will be replaced" }); await mongoose.disconnect();
  const restored = await restore(DST, DIR); assert.equal(restored.users, 2);
  await mongoose.connect(DST); const d2 = mongoose.connection.db;
  const u = await d2.collection("users").findOne({ _id: uid }); assert.equal(u.fullName, "සුනිල් / சுனில்"); assert.equal(u.createdAt.toISOString(), "2026-01-02T03:04:05.000Z"); assert.equal(await d2.collection("users").countDocuments({ fullName: "will be replaced" }), 0);
  const p = await d2.collection("photos").findOne({ owner: uid }); assert.deepEqual([...p.data.buffer], [137, 80, 78, 71, 0, 255, 1, 2]); assert.ok(String(p.owner) === String(uid));
  await d2.dropDatabase(); await mongoose.disconnect(); await mongoose.connect(SRC); await mongoose.connection.db.dropDatabase(); await mongoose.disconnect();
  console.log("ALL BACKUP / RESTORE ROUND-TRIP CHECKS PASSED (documents, Sinhala/Tamil text, dates, ObjectIds and binary photos survive)");
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
