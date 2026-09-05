const EARTH_RADIUS_METERS = 6371000;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

// Great-circle distance between two lat/lng points, in meters.
export function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

// Reads the college's coordinates from the environment. Returns null if the
// server operator hasn't configured them yet, so callers can fail gracefully
// instead of silently comparing against 0,0.
export function getCollegeGeofence() {
  const latitude = Number(process.env.COLLEGE_LATITUDE);
  const longitude = Number(process.env.COLLEGE_LONGITUDE);
  const radiusMeters = Number(process.env.COLLEGE_RADIUS_METERS) || 200;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { latitude, longitude, radiusMeters };
}

// Decides whether a reported device location counts as "on campus".
// `accuracy` (meters, from the browser's Geolocation API) is given a small,
// capped allowance so normal GPS drift doesn't wrongly block a real student
// standing on campus, without letting a spoofed/huge accuracy value fake a
// much larger allowed radius.
export function isWithinCollege(latitude, longitude, accuracy = 0) {
  const geofence = getCollegeGeofence();
  if (!geofence) {
    throw new Error("College location is not configured (COLLEGE_LATITUDE / COLLEGE_LONGITUDE).");
  }

  const distance = haversineDistanceMeters(latitude, longitude, geofence.latitude, geofence.longitude);
  const accuracyAllowance = Math.min(Math.max(Number(accuracy) || 0, 0), 50);
  const withinRange = distance <= geofence.radiusMeters + accuracyAllowance;

  return {
    withinRange,
    distance: Math.round(distance),
    radiusMeters: geofence.radiusMeters
  };
}
