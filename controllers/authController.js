const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const { sendPasswordResetOtp } = require("../utils/emailService");

function generateToken(userId, role) {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

/**
 * POST /api/auth/register
 * Creates a new user (farmer, driver, buyer, or admin) and returns a JWT.
 */
async function register(req, res) {
  try {
    const { fullName, email, phone, password, role, farmerProfile, buyerProfile, driverProfile } = req.body;

    if (!fullName || !email || !phone || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "fullName, email, phone, password, and role are required.",
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({ success: false, message: "An account with this email already exists." });
    }

    const passwordHash = await User.hashPassword(password);

    const user = await User.create({
      fullName,
      email: email.toLowerCase().trim(),
      phone,
      passwordHash,
      role,
      farmerProfile: role === "farmer" ? farmerProfile || {} : undefined,
      buyerProfile: role === "buyer" ? buyerProfile || {} : undefined,
      driverProfile: role === "driver" ? driverProfile || {} : undefined,
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
    console.error("register error:", error);
    return res.status(500).json({ success: false, message: "Registration failed.", error: error.message });
  }
}

/**
 * POST /api/auth/login
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
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
    return res.status(500).json({ success: false, message: "Login failed.", error: error.message });
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
    return res.status(500).json({ success: false, message: "Failed to fetch user.", error: error.message });
  }
}

/**
 * POST /api/auth/forgot-password
 * Generates a 6-digit OTP, stores its hash (never the raw code) with a
 * 15-minute expiry, and emails it. Always returns success (even if the
 * email doesn't exist) to avoid leaking which emails are registered.
 */
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "email is required." });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Always respond the same way whether or not the account exists —
    // prevents attackers from using this endpoint to enumerate valid emails.
    const genericResponse = {
      success: true,
      message: "If an account exists with that email, a reset code has been sent.",
    };

    if (!user) {
      return res.status(200).json(genericResponse);
    }

    const otpCode = crypto.randomInt(100000, 999999).toString();
    const otpHash = crypto.createHash("sha256").update(otpCode).digest("hex");

    user.resetPasswordOtpHash = otpHash;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    const emailSent = await sendPasswordResetOtp(user.email, otpCode);

    if (!emailSent) {
      // Email isn't configured (no EMAIL_USER/EMAIL_APP_PASSWORD in .env yet)
      // or sending failed — log it so local dev/testing isn't blocked.
      console.log(`[DEV FALLBACK] Password reset OTP for ${user.email}: ${otpCode}`);
    }

    return res.status(200).json(genericResponse);
  } catch (error) {
    console.error("forgotPassword error:", error);
    return res.status(500).json({ success: false, message: "Failed to process request.", error: error.message });
  }
}

/**
 * POST /api/auth/reset-password
 * Body: { email, otp, newPassword }
 */
async function resetPassword(req, res) {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: "email, otp, and newPassword are required." });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "newPassword must be at least 6 characters." });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select(
      "+resetPasswordOtpHash +resetPasswordExpires"
    );

    if (!user || !user.resetPasswordOtpHash || !user.resetPasswordExpires) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset code." });
    }
    if (user.resetPasswordExpires < new Date()) {
      return res.status(400).json({ success: false, message: "This reset code has expired. Please request a new one." });
    }

    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    if (otpHash !== user.resetPasswordOtpHash) {
      return res.status(400).json({ success: false, message: "Incorrect reset code." });
    }

    user.passwordHash = await User.hashPassword(newPassword);
    user.resetPasswordOtpHash = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return res.status(200).json({ success: true, message: "Password reset successfully. You can now log in." });
  } catch (error) {
    console.error("resetPassword error:", error);
    return res.status(500).json({ success: false, message: "Failed to reset password.", error: error.message });
  }
}

module.exports = { register, login, getCurrentUser, forgotPassword, resetPassword };
