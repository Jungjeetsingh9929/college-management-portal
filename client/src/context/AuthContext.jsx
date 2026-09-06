import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("attendance_token");
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch("/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => { localStorage.removeItem("attendance_token"); localStorage.removeItem("attendance_refresh_token"); })
      .finally(() => setLoading(false));
  }, []);

  async function login(credentials) {
    const data = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify(credentials) });
    localStorage.setItem("attendance_token", data.token);
    if (data.refreshToken) localStorage.setItem("attendance_refresh_token", data.refreshToken);
    setUser(data.user);
    return data.user;
  }

  async function logout() {
    const refreshToken = localStorage.getItem("attendance_refresh_token");
    if (refreshToken) await fetch(`${import.meta.env.VITE_API_URL || "/api"}/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) }).catch(() => {});
    localStorage.removeItem("attendance_token");
    localStorage.removeItem("attendance_refresh_token");
    setUser(null);
  }

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
