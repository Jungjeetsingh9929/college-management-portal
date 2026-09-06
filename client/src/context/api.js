const API_BASE = import.meta.env.VITE_API_URL || "/api";

export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem("attendance_token");
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body instanceof FormData) delete headers["Content-Type"];

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed." }));
    throw new Error(error.message || "Request failed.");
  }

  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) return response.json();
  return response;
}

export async function apiDownload(path, options = {}) {
  const token = localStorage.getItem("attendance_token");
  const target = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const response = await fetch(target, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Download failed." }));
    throw new Error(error.message || "Download failed.");
  }
  return response.blob();
}

export function reportUrl(type) {
  return `${API_BASE}/reports/${type}`;
}
