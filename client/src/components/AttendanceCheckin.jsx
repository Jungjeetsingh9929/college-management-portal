import React, { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MapPin, MapPinOff } from "lucide-react";
import { apiFetch } from "../context/api.js";
import { Badge, EmptyState } from "./UI.jsx";

// Lets a student mark themselves present for one of today's class subjects,
// but only succeeds when the browser reports a GPS location inside the
// college geofence configured on the server (COLLEGE_LATITUDE/LONGITUDE/
// RADIUS_METERS). Renders nothing if the server hasn't configured a
// geofence yet.
export function AttendanceCheckin({ onMarked }) {
  const [options, setOptions] = useState([]);
  const [geofenceConfigured, setGeofenceConfigured] = useState(true);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [checkingInId, setCheckingInId] = useState(null);
  const [feedback, setFeedback] = useState(null);

  async function loadOptions() {
    setLoadingOptions(true);
    try {
      const data = await apiFetch("/attendance/checkin-options");
      setOptions(data.options || []);
      setGeofenceConfigured(data.geofenceConfigured !== false);
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    } finally {
      setLoadingOptions(false);
    }
  }

  useEffect(() => {
    loadOptions();
  }, []);

  function getLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Your browser does not support location services."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve(position.coords),
        (error) => {
          const messages = {
            1: "Location permission was denied. Allow location access to mark attendance.",
            2: "Your location could not be determined. Try again with GPS/location turned on.",
            3: "Getting your location timed out. Please try again."
          };
          reject(new Error(messages[error.code] || "Could not get your location."));
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  async function handleCheckIn(subjectId) {
    setFeedback(null);
    setCheckingInId(subjectId);
    try {
      const coords = await getLocation();
      const data = await apiFetch("/attendance/checkin", {
        method: "POST",
        body: JSON.stringify({
          subjectId,
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy
        })
      });
      setFeedback({ type: "success", text: data.message });
      await loadOptions();
      onMarked?.();
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    } finally {
      setCheckingInId(null);
    }
  }

  if (!geofenceConfigured) return null;

  return (
    <div className="panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">On-campus only</span>
          <h2>Mark my attendance</h2>
        </div>
        <MapPin size={22} />
      </div>
      <p style={{ margin: "0 0 12px", color: "#666", fontSize: "0.9rem" }}>
        Works from anywhere in the app, but marking present only succeeds when your device shows you're physically at the college.
      </p>
      {feedback && (
        <div
          className={feedback.type === "success" ? "success-box" : "warning-banner"}
          style={{ marginBottom: 12 }}
        >
          {feedback.type === "success" ? <CheckCircle2 size={18} /> : <MapPinOff size={18} />}
          <span>{feedback.text}</span>
        </div>
      )}
      {loadingOptions ? (
        <p>Loading today's classes...</p>
      ) : options.length ? (
        <div className="list-stack">
          {options.map((option) => (
            <div className="list-row" key={option.subjectId}>
              <div>
                <strong>{option.subjectName}</strong>
                <span>{option.code} · {option.teacher}</span>
              </div>
              {option.alreadyMarked ? (
                <Badge value={option.status} />
              ) : (
                <button
                  className="primary-button small"
                  disabled={checkingInId === option.subjectId}
                  onClick={() => handleCheckIn(option.subjectId)}
                >
                  {checkingInId === option.subjectId ? (
                    <>
                      <Loader2 size={14} className="spin" /> Checking...
                    </>
                  ) : (
                    "Mark present"
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No subjects found" text="There are no subjects set up for your class yet." />
      )}
    </div>
  );
}
