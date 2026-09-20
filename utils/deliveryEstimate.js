const { getShelfLifeDays } = require("./shelfLife");
const { canonicalDistrict } = require("./chatConfig");

/** Approximate centre of each district and each wholesale hub: [longitude, latitude]. */
const DISTRICT_COORDS = {
  Ampara: [81.67, 7.3], Anuradhapura: [80.41, 8.31], Badulla: [81.05, 6.99], Batticaloa: [81.7, 7.71], Colombo: [79.86, 6.93],
  Galle: [80.22, 6.03], Gampaha: [79.99, 7.09], Hambantota: [81.12, 6.12], Jaffna: [80.03, 9.66], Kalutara: [79.96, 6.58],
  Kandy: [80.63, 7.29], Kegalle: [80.35, 7.25], Kilinochchi: [80.4, 9.4], Kurunegala: [80.36, 7.49], Mannar: [79.9, 8.98],
  Matale: [80.62, 7.47], Matara: [80.55, 5.95], Monaragala: [81.35, 6.87], Mullaitivu: [80.81, 9.27], "Nuwara Eliya": [80.77, 6.97],
  Polonnaruwa: [81.0, 7.94], Puttalam: [79.83, 8.03], Ratnapura: [80.4, 6.68], Trincomalee: [81.23, 8.57], Vavuniya: [80.5, 8.75],
};

const HUB_COORDS = {
  Dambulla: [80.6517, 7.8675],
  Colombo_Manning_Market: [79.8583, 6.9366],
  Pettah: [79.8547, 6.9355],
  Kandy: [80.6337, 7.2906],
  Jaffna: [80.0255, 9.6615],
};

const ROAD_FACTOR = 1.35; // roads are longer than a straight line
const AVERAGE_SPEED_KMH = 32; // realistic for Sri Lankan trucks, stops included
const LOADING_HOURS = 1;
const UNCOOLED_TRUCK_STRESS = 1.5; // produce ages ~50% faster in an open truck

function haversineKm([lng1, lat1], [lng2, lat2]) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function riskFor(percentRemaining) {
  if (percentRemaining >= 70) return "good";
  if (percentRemaining >= 40) return "ok";
  if (percentRemaining >= 15) return "risky";
  return "too_long";
}

/**
 * How fresh will this crop still be when a truck delivers it to each hub?
 * Uses the same shelf-life table as the Freshness Clock.
 */
function estimateDelivery({ cropType, harvestDate, district, now = new Date() }) {
  const canonical = canonicalDistrict(district);
  if (!canonical) return null;
  const shelfLifeDays = getShelfLifeDays(cropType);
  const harvest = harvestDate ? new Date(harvestDate) : now;
  const ageDaysNow = Math.max(0, (now.getTime() - harvest.getTime()) / 86400000);

  const options = Object.entries(HUB_COORDS).map(([hub, coords]) => {
    const distanceKm = Math.round(haversineKm(DISTRICT_COORDS[canonical], coords) * ROAD_FACTOR);
    const transitHours = Math.round((LOADING_HOURS + distanceKm / AVERAGE_SPEED_KMH) * 10) / 10;
    const usedDays = ageDaysNow + (transitHours / 24) * UNCOOLED_TRUCK_STRESS;
    const percentRemaining = Math.max(0, Math.round((1 - usedDays / shelfLifeDays) * 100));
    return { hub, distanceKm, transitHours, percentRemainingAtArrival: percentRemaining, risk: riskFor(percentRemaining) };
  });
  options.sort((a, b) => b.percentRemainingAtArrival - a.percentRemainingAtArrival || a.distanceKm - b.distanceKm);
  return { district: canonical, cropType, shelfLifeDays, options, best: options[0] };
}

module.exports = { DISTRICT_COORDS, HUB_COORDS, haversineKm, estimateDelivery, riskFor };
