const API_BASE = import.meta.env.VITE_API_URL || "/api";
let refreshPromise = null;

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem("attendance_refresh_token"); if (!refreshToken) return null;
  if (!refreshPromise) refreshPromise = fetch(`${API_BASE}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) }).then(async (response) => { if (!response.ok) throw new Error("Refresh failed"); const data = await response.json(); localStorage.setItem("attendance_token", data.token); if (data.refreshToken) localStorage.setItem("attendance_refresh_token", data.refreshToken); return data.token; }).catch(() => { localStorage.removeItem("attendance_token"); localStorage.removeItem("attendance_refresh_token"); return null; }).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem("attendance_token"); const headers = { "Content-Type": "application/json", ...(options.headers || {}) }; if (token) headers.Authorization = `Bearer ${token}`; if (options.body instanceof FormData) delete headers["Content-Type"];
  let response = await fetch(`${API_BASE}${path}`, { ...options, headers });
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
      response = await fetch(`${API_BASE}${path}`, { ...retryOptions, headers: retryHeaders });
    }
  }
  if (!response.ok) { const error = await response.json().catch(() => ({ message: "Request failed." })); window.dispatchEvent(new CustomEvent("portal:toast", { detail: { message: error.message || "Request failed.", tone: "error" } })); const requestError = new Error(error.message || "Request failed."); requestError.details = error; throw requestError; }
  const type = response.headers.get("content-type") || ""; if (type.includes("application/json")) return response.json(); return response;
}

// Downloads used to skip the 401 -> refresh -> retry path that apiFetch has,
// so every CSV/PDF export and file download failed with "Download failed."
// once the 15-minute access token expired, even though a valid refresh token
// was sitting in localStorage.
export async function apiDownload(path, options = {}) {
  const target = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const send = (token) => fetch(target, { ...options, headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  let response = await send(localStorage.getItem("attendance_token"));
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) response = await send(refreshed);
  }
  if (!response.ok) { const error = await response.json().catch(() => ({ message: "Download failed." })); window.dispatchEvent(new CustomEvent("portal:toast", { detail: { message: error.message || "Download failed.", tone: "error" } })); throw new Error(error.message || "Download failed."); }
  return response.blob();
}
export function reportUrl(type) { return `${API_BASE}/reports/${type}`; }

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
