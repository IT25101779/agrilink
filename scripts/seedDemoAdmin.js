/**
 * Creates (or resets) ONE demo admin account with a KNOWN password, so you can
 * log in to the admin website without needing ADMIN_SIGNUP_CODE.
 *
 * This is kept separate from scripts/seedDemoData.js on purpose — that script
 * is safe to re-run against a real deployment and deliberately never creates
 * an admin. This one does, so it requires an explicit opt-in:
 *
 *   ALLOW_DEMO_ADMIN=yes node scripts/seedDemoAdmin.js
 *
 * Without ALLOW_DEMO_ADMIN=yes it refuses to run, so it can never fire by
 * accident (e.g. as part of a build step) against your live database.
 *
 * Change DEMO_ADMIN_PASSWORD below (or set it as an env var) before running
 * this against anything other than a throwaway/demo database. Delete this
 * account before a real public launch — see README_UPDATE_5.md section "Before
 * going public".
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");

const EMAIL = (process.env.DEMO_ADMIN_EMAIL || "admin.demo@agrilink.lk").toLowerCase();
const PASSWORD = process.env.DEMO_ADMIN_PASSWORD || "Demo@Admin1234";
const NAME = "Demo Admin";
const PHONE = process.env.DEMO_ADMIN_PHONE || "+94770000099";

async function main() {
  if (process.env.ALLOW_DEMO_ADMIN !== "yes") {
    console.error(
      "Refusing to run: this creates an admin account with a known password.\n" +
        "If you really want that (e.g. for a demo/evaluation database), run:\n\n" +
        "  ALLOW_DEMO_ADMIN=yes node scripts/seedDemoAdmin.js\n"
    );
    process.exit(1);
  }
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set (check your .env file or Vercel environment variables).");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const passwordHash = await User.hashPassword(PASSWORD);
  const existing = await User.findOne({ email: EMAIL });

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.role = "admin";
    existing.isActive = true;
    existing.fullName = NAME;
    await existing.save();
    console.log(`Updated existing account ${EMAIL} to admin with a fresh password.`);
  } else {
    await User.create({
      fullName: NAME,
      email: EMAIL,
      phone: PHONE,
      passwordHash,
      role: "admin",
      isActive: true,
    });
    console.log(`Created new admin account ${EMAIL}.`);
  }

  console.log("\nLogin with:");
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log("\nDelete or change this account before any real/public launch.");

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Failed:", error.message);
  process.exit(1);
});
