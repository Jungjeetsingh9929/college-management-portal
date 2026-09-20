const STORAGE_KEY = "attendance_device_id";

// A stable, random identifier for this browser/device, persisted in
// localStorage. Not derived from any hardware or account details — it's
// only used server-side to flag a check-in as "high risk" when the same
// student's account suddenly checks in from a device it hasn't used
// before (see server/routes/attendance.js `/check-in`).
export function getDeviceFingerprint() {
  try {
    let id = window.localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    // Storage unavailable (private browsing, etc.) - check-in still works,
    // it just won't get device-risk scoring for this session.
    return null;
  }
}
