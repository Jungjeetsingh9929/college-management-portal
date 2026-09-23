import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, setOnUserRefreshed } from "./api.js";

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
    // apiFetch already retries a 401 here via refreshAccessToken(), and that
    // function clears both tokens itself if the refresh token turns out to
    // be expired/revoked — the only case that should sign someone out.
    // Clearing tokens on *any* rejection here (a network hiccup, a 500, etc.)
    // logged people out just because /auth/me had a bad moment, so this only
    // updates loading state and leaves user signed out for this load without
    // touching storage.
    apiFetch("/auth/me", { _silent: true })
      .then((data) => setUser(data.user))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // POST /auth/refresh now returns the same `user` shape /auth/login and
  // /auth/me do, computed fresh from the database. Wiring it in here means
  // role metadata (e.g. a teacher's isHod, set/unset by an admin) catches up
  // on the next silent background token refresh (every ~15 minutes) instead
  // of staying frozen at whatever it was at last login/page-load for the
  // rest of a session that, by design, can stay open indefinitely.
  useEffect(() => {
    setOnUserRefreshed((freshUser) => setUser(freshUser));
    function onSessionExpired() {
      localStorage.removeItem("attendance_token");
      localStorage.removeItem("attendance_refresh_token");
      setUser(null);
      window.dispatchEvent(new CustomEvent("portal:toast", { detail: { message: "Your session expired. Please sign in again.", tone: "error" } }));
    }
    window.addEventListener("portal:session-expired", onSessionExpired);
    return () => {
      setOnUserRefreshed(null);
      window.removeEventListener("portal:session-expired", onSessionExpired);
    };
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

  // Merges fresh fields (e.g. the student record returned by PUT
  // /students/me/profile) into the signed-in user without dropping session-only
  // fields such as `role`, which /auth/me adds on top of the stored record.
  const updateUser = useCallback((patch) => {
    setUser((current) => (current && patch && typeof patch === "object" ? { ...current, ...patch, role: current.role } : current));
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, updateUser }), [user, loading, updateUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
