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
      .catch(() => localStorage.removeItem("attendance_token"))
      .finally(() => setLoading(false));
  }, []);

  async function login(credentials) {
    const data = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify(credentials) });
    localStorage.setItem("attendance_token", data.token);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem("attendance_token");
    setUser(null);
  }

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
