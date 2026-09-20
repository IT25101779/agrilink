const mongoose = require("mongoose");
/** Fertilizer / seed subsidy and other support the farmer received, with a reminder for the next one. */
const SubsidyRecordSchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["fertilizer", "seed", "cash", "equipment", "other"], required: true },
    item: { type: String, default: "", maxlength: 80 },
    quantity: { type: Number, default: 0 },
    unit: { type: String, default: "", maxlength: 12 },
    valueLkr: { type: Number, default: 0 },
    receivedOn: { type: Date, required: true },
    nextDueOn: { type: Date },
    note: { type: String, default: "", maxlength: 120 },
    clientId: { type: String, default: "" },
  },
  { timestamps: true }
);
SubsidyRecordSchema.index({ farmer: 1, receivedOn: -1 });
SubsidyRecordSchema.index({ nextDueOn: 1 });
module.exports = mongoose.model("SubsidyRecord", SubsidyRecordSchema);
