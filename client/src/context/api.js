const API_BASE = import.meta.env.VITE_API_URL || "/api";
let refreshPromise = null;
// Set by AuthContext so a silent background token refresh can also push the
// fresh `user` object (role metadata like isHod) into React state, instead
// of only updating localStorage. Left unset outside of AuthProvider (e.g. in
// tests) - refreshAccessToken still works, it just can't update user state.
let onUserRefreshed = null;
export function setOnUserRefreshed(callback) { onUserRefreshed = callback; }

function notifySessionExpired() {
  window.dispatchEvent(new CustomEvent("portal:session-expired"));
}

function networkError(error) {
  const requestError = new Error("The portal could not reach the server. Check your connection and try again.");
  requestError.cause = error;
  return requestError;
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem("attendance_refresh_token"); if (!refreshToken) return null;
  if (!refreshPromise) refreshPromise = fetch(`${API_BASE}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) }).then(async (response) => { if (!response.ok) throw new Error("Refresh failed"); const data = await response.json(); localStorage.setItem("attendance_token", data.token); if (data.refreshToken) localStorage.setItem("attendance_refresh_token", data.refreshToken); if (data.user && onUserRefreshed) onUserRefreshed(data.user); return data.token; }).catch(() => { localStorage.removeItem("attendance_token"); localStorage.removeItem("attendance_refresh_token"); return null; }).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem("attendance_token"); const headers = { "Content-Type": "application/json", ...(options.headers || {}) }; if (token) headers.Authorization = `Bearer ${token}`; if (options.body instanceof FormData) delete headers["Content-Type"];
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (error) {
    const requestError = networkError(error);
    if (!options._silent) window.dispatchEvent(new CustomEvent("portal:toast", { detail: { message: requestError.message, tone: "error" } }));
    throw requestError;
  }
  if (response.status === 401 && !options._retry && path !== "/auth/login" && path !== "/auth/refresh") {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const retryHeaders = { ...headers, Authorization: `Bearer ${refreshed}` };
      // A FormData body is a one-shot stream: it is already consumed by the
      // first request, so replaying the same object sent an empty body on the
      // retry and the upload silently failed. Re-reading it isn't possible
      // here, so surface a clear error instead of a corrupt upload.
      if (options.body instanceof FormData) throw new Error("Your session expired during the upload. Please try again.");
      const { _retry, ...retryOptions } = options;
      try {
        response = await fetch(`${API_BASE}${path}`, { ...retryOptions, headers: retryHeaders });
      } catch (error) {
        const requestError = networkError(error);
        if (!options._silent) window.dispatchEvent(new CustomEvent("portal:toast", { detail: { message: requestError.message, tone: "error" } }));
        throw requestError;
      }
    } else {
      notifySessionExpired();
    }
  }
  if (!response.ok) { const error = await response.json().catch(() => ({ message: "Request failed." })); if (!options._silent) window.dispatchEvent(new CustomEvent("portal:toast", { detail: { message: error.message || "Request failed.", tone: "error" } })); const requestError = new Error(error.message || "Request failed."); requestError.details = error; throw requestError; }
  const type = response.headers.get("content-type") || ""; if (type.includes("application/json")) return response.json(); return response;
}

// Downloads used to skip the 401 -> refresh -> retry path that apiFetch has,
// so every CSV/PDF export and file download failed with "Download failed."
// once the 15-minute access token expired, even though a valid refresh token
// was sitting in localStorage.
export async function apiDownload(path, options = {}) {
  const target = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const send = (token) => fetch(target, { ...options, headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  let response;
  try {
    response = await send(localStorage.getItem("attendance_token"));
  } catch (error) {
    const requestError = networkError(error);
    window.dispatchEvent(new CustomEvent("portal:toast", { detail: { message: requestError.message, tone: "error" } }));
    throw requestError;
  }
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      try {
        response = await send(refreshed);
      } catch (error) {
        const requestError = networkError(error);
        window.dispatchEvent(new CustomEvent("portal:toast", { detail: { message: requestError.message, tone: "error" } }));
        throw requestError;
      }
    } else notifySessionExpired();
  }
  if (!response.ok) { const error = await response.json().catch(() => ({ message: "Download failed." })); window.dispatchEvent(new CustomEvent("portal:toast", { detail: { message: error.message || "Download failed.", tone: "error" } })); throw new Error(error.message || "Download failed."); }
  return response.blob();
}
export function reportPath(type) { return `/reports/${type}`; }

export async function downloadToFile(path, filename) {
  const blob = await apiDownload(path);
  const urlObj = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = urlObj;
  anchor.download = filename;
  // The anchor has to be in the document for the synthetic click to fire in
  // Firefox, and revoking the object URL in the same tick cancelled the
  // download before the browser had read from it.
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => { document.body.removeChild(anchor); URL.revokeObjectURL(urlObj); }, 0);
}
