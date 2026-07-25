require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const connectDB = require("./config/db");

const marketplaceRoutes = require("./routes/marketplace");
const pricePredictionRoutes = require("./routes/priceprediction");
const authRoutes = require("./routes/auth");
const diseaseRoutes = require("./routes/disease");
const adminRoutes = require("./routes/admin");
const adsRoutes = require("./routes/ads");
const logisticsRoutes = require("./routes/logistics");
const crowdfundingRoutes = require("./routes/crowdfunding");
const chatRoutes = require("./routes/chat");
const reminderRoutes = require("./routes/reminders");
const supplierRoutes = require("./routes/suppliers");

const app = express();

// ---- Core middleware ----
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// ---- Health check ----
app.get("/api/health", (req, res) => {
  res.status(200).json({ success: true, message: "AgriLink AI 2.0 backend is running." });
});

// ---- Feature routes ----
app.use("/api/auth", authRoutes);
app.use("/api/marketplace", marketplaceRoutes);
app.use("/api/price-predict", pricePredictionRoutes);
app.use("/api/disease", diseaseRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/ads", adsRoutes);
app.use("/api/logistics", logisticsRoutes);
app.use("/api/crowdfunding", crowdfundingRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/reminders", reminderRoutes);
app.use("/api/suppliers", supplierRoutes);

// ---- 404 handler ----
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found.` });
});

// ---- Global error handler ----
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, message: "Internal server error." });
});

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`AgriLink AI 2.0 backend listening on port ${PORT}`);
  });
});

module.exports = app;
