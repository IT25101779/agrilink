/**
 * Backs up EVERY collection to compressed files, without needing mongodump.
 *   node scripts/backup.js [folder]         (default: ./backups/<date>)
 * Restore with:  node scripts/restore.js <folder> --yes
 * Atlas' free (M0) tier has no automatic backups, so run this on a schedule (see README_UPDATE_5.md).
 */
require("dotenv").config();
const fs = require("fs"); const path = require("path"); const zlib = require("zlib"); const mongoose = require("mongoose");
const { EJSON } = mongoose.mongo.BSON;

async function backup(uri, folder) {
  await mongoose.connect(uri);
  fs.mkdirSync(folder, { recursive: true });
  const collections = await mongoose.connection.db.listCollections().toArray();
  const summary = {};
  for (const { name } of collections) {
    if (name.startsWith("system.")) continue;
    const docs = await mongoose.connection.db.collection(name).find({}).toArray();
    fs.writeFileSync(path.join(folder, name + ".json.gz"), zlib.gzipSync(EJSON.stringify(docs, { relaxed: false })));
    summary[name] = docs.length;
  }
  fs.writeFileSync(path.join(folder, "_summary.json"), JSON.stringify({ takenAt: new Date(), counts: summary }, null, 2));
  await mongoose.disconnect();
  return summary;
}

module.exports = { backup };
if (require.main === module) {
  const folder = process.argv[2] || path.join("backups", new Date().toISOString().slice(0, 10));
  backup(process.env.MONGO_URI || process.env.MONGODB_URI, folder).then((s) => { console.log(`Backed up ${Object.keys(s).length} collections (${Object.values(s).reduce((a, b) => a + b, 0)} documents) to ${folder}`); }).catch((e) => { console.error("Backup failed:", e.message); process.exit(1); });
}
