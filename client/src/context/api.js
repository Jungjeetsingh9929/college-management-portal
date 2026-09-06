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
  if (response.status === 401 && !options._retry && path !== "/auth/login" && path !== "/auth/refresh") { const refreshed = await refreshAccessToken(); if (refreshed) { const retryHeaders = { ...headers, Authorization: `Bearer ${refreshed}` }; response = await fetch(`${API_BASE}${path}`, { ...options, headers: retryHeaders, _retry: true }); } }
  if (!response.ok) { const error = await response.json().catch(() => ({ message: "Request failed." })); window.dispatchEvent(new CustomEvent("portal:toast", { detail: { message: error.message || "Request failed.", tone: "error" } })); const requestError = new Error(error.message || "Request failed."); requestError.details = error; throw requestError; }
  const type = response.headers.get("content-type") || ""; if (type.includes("application/json")) return response.json(); return response;
}

export async function apiDownload(path, options = {}) { const token = localStorage.getItem("attendance_token"); const target = path.startsWith("http") ? path : `${API_BASE}${path}`; const response = await fetch(target, { ...options, headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } }); if (!response.ok) { const error = await response.json().catch(() => ({ message: "Download failed." })); window.dispatchEvent(new CustomEvent("portal:toast", { detail: { message: error.message || "Download failed.", tone: "error" } })); throw new Error(error.message || "Download failed."); } return response.blob(); }
export function reportUrl(type) { return `${API_BASE}/reports/${type}`; }
