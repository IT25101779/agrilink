const mongoose = require("mongoose");

const SurveyResponseSchema = new mongoose.Schema(
  {
    survey: { type: mongoose.Schema.Types.ObjectId, ref: "Survey", required: true },
    respondent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    district: { type: String, default: "" },
    answers: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

SurveyResponseSchema.index({ survey: 1, respondent: 1 }, { unique: true });

module.exports = mongoose.model("SurveyResponse", SurveyResponseSchema);
