/**
 * Restores a backup made by scripts/backup.js.
 *   node scripts/restore.js <folder> --yes
 * It REPLACES the contents of each backed-up collection in the database MONGO_URI points to, so it asks for --yes.
 */
require("dotenv").config();
const fs = require("fs"); const path = require("path"); const zlib = require("zlib"); const mongoose = require("mongoose");
const { EJSON } = mongoose.mongo.BSON;

async function restore(uri, folder) {
  await mongoose.connect(uri);
  const done = {};
  for (const file of fs.readdirSync(folder).filter((f) => f.endsWith(".json.gz"))) {
    const name = file.replace(".json.gz", "");
    const docs = EJSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(folder, file))).toString("utf8"));
    const col = mongoose.connection.db.collection(name);
    await col.deleteMany({});
    if (docs.length) await col.insertMany(docs);
    done[name] = docs.length;
  }
  await mongoose.disconnect();
  return done;
}

module.exports = { restore };
if (require.main === module) {
  const folder = process.argv[2];
  if (!folder || !process.argv.includes("--yes")) { console.error("Usage: node scripts/restore.js <backup-folder> --yes\n(This REPLACES data in the database MONGO_URI points to.)"); process.exit(1); }
  restore(process.env.MONGO_URI || process.env.MONGODB_URI, folder).then((d) => console.log(`Restored ${Object.keys(d).length} collections.`)).catch((e) => { console.error("Restore failed:", e.message); process.exit(1); });
}
