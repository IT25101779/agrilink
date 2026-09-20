const mongoose = require("mongoose");

/** A short survey the admin sends to farmers — real answers become real evidence. */
const SurveySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 120 },
    intro: { type: String, default: "", maxlength: 300 },
    questions: {
      type: [
        {
          key: { type: String, required: true },
          kind: { type: String, enum: ["single", "number", "scale", "text"], required: true },
          text: { type: String, required: true, maxlength: 200 },
          options: { type: [String], default: [] },
          unit: { type: String, default: "" },
          required: { type: Boolean, default: true },
        },
      ],
      required: true,
    },
    audienceDistricts: { type: [String], default: [] }, // empty = every district
    isActive: { type: Boolean, default: true },
    closesAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Survey", SurveySchema);
