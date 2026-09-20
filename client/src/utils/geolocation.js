// Asks the browser for the device's current GPS coordinates. Shared by
// every flow that needs an on-campus location check (quiz answers, QR
// attendance check-in) so the behavior — including the 20s fallback
// timeout for a stuck permission prompt — is identical everywhere.
export function getLocation(deniedContext = "continue") {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Your browser does not support location services."));
      return;
    }
    const fallbackTimer = window.setTimeout(() => reject(new Error("Location permission is taking too long. Allow location access and try again.")), 20000);
    navigator.geolocation.getCurrentPosition(
      (position) => { window.clearTimeout(fallbackTimer); resolve(position.coords); },
      (error) => {
        window.clearTimeout(fallbackTimer);
        const messages = {
          1: `Location permission was denied. Allow location access to ${deniedContext}.`,
          2: "Your location could not be determined. Try again with GPS/location turned on.",
          3: "Getting your location timed out. Please try again."
        };
        reject(new Error(messages[error.code] || "Could not get your location."));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}
