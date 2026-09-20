const mongoose = require("mongoose");

/** A rating one side of a completed order gives the other. One per person per order. */
const RatingSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "TradeOrder", required: true },
    rater: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ratee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    stars: { type: Number, required: true, min: 1, max: 5 },
    tags: { type: [String], default: [] },
    comment: { type: String, default: "", maxlength: 200 },
  },
  { timestamps: true }
);

RatingSchema.index({ order: 1, rater: 1 }, { unique: true });
RatingSchema.index({ ratee: 1, createdAt: -1 });

module.exports = mongoose.model("Rating", RatingSchema);
