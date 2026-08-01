const mongoose = require("mongoose");

// Caches the connection promise across serverless function invocations
// (Vercel can reuse a "warm" instance between requests) so we don't open
// a new MongoDB connection on every single request, which would quickly
// exhaust Atlas's connection limit. Falls back to a plain one-time
// connection when running locally / on a traditional server like Render.
let cachedConnectionPromise = null;

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI is not set in your environment variables.");
  }

  // Already connected (or connecting) — reuse it.
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!cachedConnectionPromise) {
    cachedConnectionPromise = mongoose.connect(uri).then((conn) => {
      console.log("MongoDB connected successfully");
      return conn;
    }).catch((error) => {
      console.error("MongoDB connection failed:", error.message);
      cachedConnectionPromise = null; // allow retry on next request
      throw error;
    });
  }

  return cachedConnectionPromise;
}

module.exports = connectDB;
