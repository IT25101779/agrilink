const mongoose = require("mongoose");
/** Where to get real help: Agrarian Service Centres, extension officers, cooperatives... Entered by the admin. */
const AgriOfficeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 100 },
    kind: { type: String, enum: ["agrarian_service_centre", "extension_officer", "cooperative", "research_station", "government_office", "other"], required: true },
    district: { type: String, required: true },
    phone: { type: String, default: "" },
    address: { type: String, default: "", maxlength: 200 },
    hours: { type: String, default: "", maxlength: 80 },
    isSample: { type: Boolean, default: false }, // demo rows are labelled so nobody mistakes them for real contacts
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
AgriOfficeSchema.index({ district: 1, kind: 1 });
module.exports = mongoose.model("AgriOffice", AgriOfficeSchema);
