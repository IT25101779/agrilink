const mongoose = require("mongoose");
const User = require("../models/User");
const ProfileImage = require("../models/ProfileImage");
const { canonicalDistrict, sniffImage } = require("../utils/chatConfig");

const SOIL_TYPES = ["loamy", "clay", "sandy", "silty", "peaty", "chalky", "unknown"];
const BUYER_TYPES = ["supermarket", "hotel", "exporter", "factory", "restaurant", "compost_hub"];
const MAX_AVATAR_BYTES = 300 * 1024;
const PHONE_REGEX = /^\+?[0-9][0-9 \-]{6,17}$/;

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function publicUser(user) {
  const u = user.toObject ? user.toObject() : user;
  delete u.passwordHash;
  delete u.resetPasswordOtpHash;
  delete u.resetPasswordExpires;
  u.hasAvatar = Boolean(u.avatarUpdatedAt);
  return u;
}

/**
 * PATCH /api/auth/me — edit your own details. Only fields that make sense for
 * your role are accepted; the server-controlled ones (credit score, verified
 * badge, role, email) can't be changed here.
 */
async function updateMe(req, res) {
  try {
    const user = await User.findById(req.userId);
    if (!user) return fail(res, 404, "User not found.");
    const b = req.body || {};
    const set = {};

    if (b.fullName !== undefined) {
      const name = String(b.fullName).trim();
      if (name.length < 2 || name.length > 80) return fail(res, 400, "Name must be 2–80 characters.");
      set.fullName = name;
    }
    if (b.phone !== undefined) {
      const phone = String(b.phone).trim();
      if (!PHONE_REGEX.test(phone)) return fail(res, 400, "Please enter a valid phone number.");
      set.phone = phone;
    }
    if (b.preferredLanguage !== undefined) {
      if (!["si", "ta", "en"].includes(b.preferredLanguage)) return fail(res, 400, "Unsupported language.");
      set.preferredLanguage = b.preferredLanguage;
    }

    if (b.smsAlerts !== undefined) set.smsAlerts = b.smsAlerts === true;
    if (user.role === "farmer" && b.farmerProfile && typeof b.farmerProfile === "object") {
      const f = b.farmerProfile;
      if (f.district !== undefined) {
        const d = canonicalDistrict(f.district);
        if (!d) return fail(res, 400, "Please choose a valid district.");
        set["farmerProfile.district"] = d;
      }
      if (f.landSizeAcres !== undefined) {
        const acres = Number(f.landSizeAcres);
        if (!Number.isFinite(acres) || acres <= 0 || acres > 10000) return fail(res, 400, "Land size must be between 0 and 10,000 acres.");
        set["farmerProfile.landSizeAcres"] = acres;
      }
      if (f.soilType !== undefined) {
        if (!SOIL_TYPES.includes(f.soilType)) return fail(res, 400, "Unknown soil type.");
        set["farmerProfile.soilType"] = f.soilType;
      }
    }
    if (user.role === "buyer" && b.buyerProfile && typeof b.buyerProfile === "object") {
      const p = b.buyerProfile;
      if (p.companyName !== undefined) set["buyerProfile.companyName"] = String(p.companyName).trim().slice(0, 100);
      if (p.buyerType !== undefined) {
        if (!BUYER_TYPES.includes(p.buyerType)) return fail(res, 400, "Unknown buyer type.");
        set["buyerProfile.buyerType"] = p.buyerType;
      }
    }
    if (user.role === "driver" && b.driverProfile && typeof b.driverProfile === "object") {
      const p = b.driverProfile;
      if (p.vehicleRegistrationNo !== undefined) set["driverProfile.vehicleRegistrationNo"] = String(p.vehicleRegistrationNo).trim().slice(0, 20);
      if (p.vehicleCapacityKg !== undefined) {
        const cap = Number(p.vehicleCapacityKg);
        if (!Number.isFinite(cap) || cap < 50 || cap > 60000) return fail(res, 400, "Vehicle capacity must be between 50 and 60,000 kg.");
        set["driverProfile.vehicleCapacityKg"] = cap;
      }
    }

    if (Object.keys(set).length === 0) return fail(res, 400, "Nothing to update.");
    await User.updateOne({ _id: req.userId }, { $set: set }, { runValidators: true });
    const updated = await User.findById(req.userId);
    return res.status(200).json({ success: true, data: publicUser(updated) });
  } catch (error) {
    console.error("updateMe error:", error);
    return fail(res, 500, "Failed to update your profile.");
  }
}

/** POST /api/auth/change-password { currentPassword, newPassword } */
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== "string" || typeof newPassword !== "string") return fail(res, 400, "Both passwords are required.");
    if (newPassword.length < 6) return fail(res, 400, "New password must be at least 6 characters.");
    if (newPassword === currentPassword) return fail(res, 400, "New password must be different.");
    const user = await User.findById(req.userId);
    if (!user || !(await user.comparePassword(currentPassword))) return fail(res, 401, "Your current password is incorrect.");
    user.passwordHash = await User.hashPassword(newPassword);
    await user.save();
    return res.status(200).json({ success: true, message: "Password changed." });
  } catch (error) {
    console.error("changePassword error:", error);
    return fail(res, 500, "Failed to change the password.");
  }
}

/** PUT /api/auth/me/avatar { imageBase64 } — JPEG / PNG / WebP up to 300 KB. */
async function setAvatar(req, res) {
  try {
    const text = String((req.body || {}).imageBase64 || "").replace(/^data:[^;]+;base64,/, "");
    if (!text || !/^[A-Za-z0-9+/=\s]+$/.test(text)) return fail(res, 400, "The photo could not be read.");
    const bytes = Buffer.from(text, "base64");
    if (bytes.length > MAX_AVATAR_BYTES) return fail(res, 413, "This photo is too large. Please choose a smaller one.");
    const mime = sniffImage(bytes);
    if (!mime) return fail(res, 400, "Only JPEG, PNG or WebP photos are allowed.");
    await ProfileImage.findOneAndUpdate({ user: req.userId }, { user: req.userId, mime, data: bytes, size: bytes.length }, { upsert: true, new: true, setDefaultsOnInsert: true });
    const now = new Date();
    await User.updateOne({ _id: req.userId }, { $set: { avatarUpdatedAt: now } });
    return res.status(200).json({ success: true, avatarUpdatedAt: now });
  } catch (error) {
    console.error("setAvatar error:", error);
    return fail(res, 500, "Failed to save the photo.");
  }
}

async function removeAvatar(req, res) {
  try {
    await ProfileImage.deleteOne({ user: req.userId });
    await User.updateOne({ _id: req.userId }, { $unset: { avatarUpdatedAt: 1 } });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("removeAvatar error:", error);
    return fail(res, 500, "Failed to remove the photo.");
  }
}

/** GET /api/auth/avatar/:userId — signed-in users only. */
async function getAvatar(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) return fail(res, 400, "Invalid user.");
    const image = await ProfileImage.findOne({ user: req.params.userId });
    if (!image) return fail(res, 404, "No photo.");
    res.set("Content-Type", image.mime);
    res.set("Cache-Control", "private, max-age=3600");
    return res.status(200).send(image.data);
  } catch (error) {
    console.error("getAvatar error:", error);
    return fail(res, 500, "Failed to load the photo.");
  }
}

module.exports = { updateMe, changePassword, setAvatar, removeAvatar, getAvatar, publicUser };
