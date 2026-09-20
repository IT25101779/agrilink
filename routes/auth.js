const express = require("express");
const router = express.Router();
const { register, login, getCurrentUser, forgotPassword, resetPassword } = require("../controllers/authController");
const profile = require("../controllers/profileController");
const { protect } = require("../middleware/authMiddleware");

router.post("/register", register);
router.post("/login", login);
router.get("/me", protect, getCurrentUser);
router.patch("/me", protect, profile.updateMe);
router.put("/me/avatar", protect, profile.setAvatar);
router.delete("/me/avatar", protect, profile.removeAvatar);
router.get("/avatar/:userId", protect, profile.getAvatar);
router.post("/change-password", protect, profile.changePassword);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

module.exports = router;
