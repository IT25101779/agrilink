const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const { sendPasswordResetOtp } = require("../utils/emailService");

const ALLOWED_ROLES = ["farmer", "driver", "buyer", "admin"];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 15;
const OTP_MAX_WRONG_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;

function generateToken(userId, role) {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

// Compares two strings without leaking (via timing) how many characters matched.
function safeEqual(a, b) {
  const bufA = Buffer.from(sha256(a));
  const bufB = Buffer.from(sha256(b));
  return crypto.timingSafeEqual(bufA, bufB);
}

// Only these fields may be set by the person registering. Anything else
// (creditScore, completedTimelinesCount, verifiedBusiness, isOnDuty...)
// is controlled by the server, so nobody can sign up with a perfect credit
// score or a "verified" business badge just by editing the request.
function pickFarmerProfile(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  if (typeof input.district === "string") out.district = input.district.trim();
  if (typeof input.landSizeAcres === "number") out.landSizeAcres = input.landSizeAcres;
  if (typeof input.soilType === "string") out.soilType = input.soilType;
  return out;
}

function pickBuyerProfile(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  if (typeof input.companyName === "string") out.companyName = input.companyName.trim();
  if (typeof input.buyerType === "string") out.buyerType = input.buyerType;
  return out;
}

function pickDriverProfile(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  if (typeof input.vehicleRegistrationNo === "string") out.vehicleRegistrationNo = input.vehicleRegistrationNo.trim();
  if (typeof input.vehicleCapacityKg === "number") out.vehicleCapacityKg = input.vehicleCapacityKg;
  return out;
}

/**
 * POST /api/auth/register
 * Creates a new user (farmer, driver, buyer, or admin) and returns a JWT.
 *
 * ADMIN ACCOUNTS: previously anyone could register as "admin" by sending
 * role: "admin", which gave them the admin dashboard and every admin-only
 * API. Now an admin account can only be created when the server has an
 * ADMIN_SIGNUP_CODE environment variable set AND the request includes the
 * matching adminCode. If ADMIN_SIGNUP_CODE is not set, admin registration
 * is switched off completely (existing admin accounts still log in fine).
 */
async function register(req, res) {
  try {
    const { fullName, email, phone, password, role, adminCode, farmerProfile, buyerProfile, driverProfile } = req.body;

    if (!fullName || !email || !phone || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "fullName, email, phone, password, and role are required.",
      });
    }
    if (typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role." });
    }

    if (role === "admin") {
      const expectedCode = process.env.ADMIN_SIGNUP_CODE;
      if (!expectedCode) {
        return res.status(403).json({
          success: false,
          message: "Admin registration is disabled on this server.",
        });
      }
      if (typeof adminCode !== "string" || !safeEqual(adminCode, expectedCode)) {
        return res.status(403).json({ success: false, message: "Incorrect admin sign-up code." });
      }
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ success: false, message: "An account with this email already exists." });
    }

    const passwordHash = await User.hashPassword(password);

    const user = await User.create({
      fullName: String(fullName).trim(),
      email: normalizedEmail,
      phone: String(phone).trim(),
      passwordHash,
      role,
      farmerProfile: role === "farmer" ? pickFarmerProfile(farmerProfile) : undefined,
      buyerProfile: role === "buyer" ? pickBuyerProfile(buyerProfile) : undefined,
      driverProfile: role === "driver" ? pickDriverProfile(driverProfile) : undefined,
    });

    const token = generateToken(user._id, user.role);

    return res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    // Two people registering the same email at the same instant: the unique
    // index rejects the second one — treat it as "already exists", not a crash.
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: "An account with this email already exists." });
    }
    console.error("register error:", error);
    return res.status(500).json({ success: false, message: "Registration failed. Please try again." });
  }
}

/**
 * POST /api/auth/login
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ success: false, message: "email and password are required." });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: "This account has been deactivated." });
    }

    const token = generateToken(user._id, user.role);

    return res.status(200).json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          farmerProfile: user.farmerProfile,
        },
      },
    });
  } catch (error) {
    console.error("login error:", error);
    return res.status(500).json({ success: false, message: "Login failed. Please try again." });
  }
}

/**
 * GET /api/auth/me
 * Requires Authorization: Bearer <token> header, verified by authMiddleware.
 */
async function getCurrentUser(req, res) {
  try {
    const user = await User.findById(req.userId).select("-passwordHash");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    return res.status(200).json({ success: true, data: user });
  } catch (error) {
    console.error("getCurrentUser error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch user." });
  }
}

/**
 * POST /api/auth/forgot-password
 * Generates a 6-digit OTP, stores its hash (never the raw code) with a
 * 15-minute expiry, and emails it. Always returns success (even if the
 * email doesn't exist) to avoid leaking which emails are registered.
 *
 * A 60-second cooldown stops someone from using this endpoint to spam a
 * person's inbox with reset emails.
 */
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ success: false, message: "email is required." });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+resetPasswordExpires");

    const genericResponse = {
      success: true,
      message: "If an account exists with that email, a reset code has been sent.",
    };

    if (!user) {
      return res.status(200).json(genericResponse);
    }

    // Cooldown: a code was issued less than 60 seconds ago -> don't send another.
    if (user.resetPasswordExpires) {
      const issuedAt = user.resetPasswordExpires.getTime() - OTP_EXPIRY_MINUTES * 60 * 1000;
      if (Date.now() - issuedAt < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
        return res.status(200).json(genericResponse);
      }
    }

    // randomInt's upper bound is exclusive, so 1000000 gives 100000-999999.
    const otpCode = crypto.randomInt(100000, 1000000).toString();

    user.resetPasswordOtpHash = sha256(otpCode);
    user.resetPasswordExpires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    user.resetPasswordAttempts = 0;
    await user.save();

    const emailSent = await sendPasswordResetOtp(user.email, otpCode);

    if (!emailSent) {
      // Email isn't configured (no EMAIL_USER/EMAIL_APP_PASSWORD) or sending
      // failed — log it so testing isn't blocked. Visible in Vercel logs.
      console.log(`[DEV FALLBACK] Password reset OTP for ${user.email}: ${otpCode}`);
    }

    return res.status(200).json(genericResponse);
  } catch (error) {
    console.error("forgotPassword error:", error);
    return res.status(500).json({ success: false, message: "Failed to process request." });
  }
}

/**
 * POST /api/auth/reset-password
 * Body: { email, otp, newPassword }
 *
 * A 6-digit code only has 1,000,000 possibilities, so without a limit it
 * could be guessed by a script within minutes. After 5 wrong guesses the
 * code is destroyed and the person must request a new one.
 */
async function resetPassword(req, res) {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: "email, otp, and newPassword are required." });
    }
    if (typeof email !== "string" || typeof newPassword !== "string") {
      return res.status(400).json({ success: false, message: "Invalid request." });
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select(
      "+resetPasswordOtpHash +resetPasswordExpires +resetPasswordAttempts"
    );

    if (!user || !user.resetPasswordOtpHash || !user.resetPasswordExpires) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset code." });
    }
    if (user.resetPasswordExpires < new Date()) {
      return res.status(400).json({ success: false, message: "This reset code has expired. Please request a new one." });
    }

    if (!safeEqual(sha256(otp), user.resetPasswordOtpHash)) {
      const attempts = (user.resetPasswordAttempts || 0) + 1;
      if (attempts >= OTP_MAX_WRONG_ATTEMPTS) {
        user.resetPasswordOtpHash = undefined;
        user.resetPasswordExpires = undefined;
        user.resetPasswordAttempts = 0;
        await user.save();
        return res.status(400).json({
          success: false,
          message: "Too many incorrect attempts. Please request a new reset code.",
        });
      }
      user.resetPasswordAttempts = attempts;
      await user.save();
      return res.status(400).json({
        success: false,
        message: `Incorrect reset code. ${OTP_MAX_WRONG_ATTEMPTS - attempts} attempt(s) left.`,
      });
    }

    user.passwordHash = await User.hashPassword(newPassword);
    user.resetPasswordOtpHash = undefined;
    user.resetPasswordExpires = undefined;
    user.resetPasswordAttempts = 0;
    await user.save();

    return res.status(200).json({ success: true, message: "Password reset successfully. You can now log in." });
  } catch (error) {
    console.error("resetPassword error:", error);
    return res.status(500).json({ success: false, message: "Failed to reset password." });
  }
}

module.exports = { register, login, getCurrentUser, forgotPassword, resetPassword };
