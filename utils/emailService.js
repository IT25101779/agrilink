const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
    return null;
  }

  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD,
    },
  });

  return transporter;
}

/**
 * Sends a 6-digit OTP code to the given email for password reset.
 * Returns true on success, false if email isn't configured or sending fails
 * (caller decides how to handle that — e.g. dev fallback of logging the OTP).
 */
async function sendPasswordResetOtp(toEmail, otpCode) {
  const transport = getTransporter();
  if (!transport) return false;

  try {
    await transport.sendMail({
      from: `"AgriLink AI" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: "Your AgriLink AI password reset code",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #0B5D3B;">AgriLink AI</h2>
          <p>Use this code to reset your password. It expires in 15 minutes.</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; background: #EFF7F1; color: #0B5D3B; padding: 16px; text-align: center; border-radius: 8px; margin: 20px 0;">
            ${otpCode}
          </div>
          <p style="color: #7C8B82; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    });
    return true;
  } catch (error) {
    console.error("Failed to send password reset email:", error.message);
    return false;
  }
}

/**
 * Sends a 6-digit OTP code to confirm a new account's email address before
 * it's created. Same shape as sendPasswordResetOtp, different copy — kept
 * as a separate function so the two can't be confused in the caller.
 */
async function sendRegistrationOtp(toEmail, otpCode) {
  const transport = getTransporter();
  if (!transport) return false;

  try {
    await transport.sendMail({
      from: `"AgriLink AI" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: "Confirm your AgriLink AI account",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #0B5D3B;">AgriLink AI</h2>
          <p>Welcome! Use this code to confirm your email and finish creating your account. It expires in 15 minutes.</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; background: #EFF7F1; color: #0B5D3B; padding: 16px; text-align: center; border-radius: 8px; margin: 20px 0;">
            ${otpCode}
          </div>
          <p style="color: #7C8B82; font-size: 13px;">If you didn't try to create an AgriLink AI account, you can safely ignore this email — nothing is created until this code is entered.</p>
        </div>
      `,
    });
    return true;
  } catch (error) {
    console.error("Failed to send registration email:", error.message);
    return false;
  }
}

module.exports = { sendPasswordResetOtp, sendRegistrationOtp };
