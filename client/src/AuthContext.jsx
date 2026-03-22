import { createContext, useContext, useState, useEffect, useCallback } from "react";

const AuthContext = createContext(null);

const API = import.meta.env.VITE_API_URL ?? "";

export function AuthProvider({ children }) {
  const [token, setToken]   = useState(() => sessionStorage.getItem("access_token"));
  const [user, setUser]     = useState(null);
  const [loading, setLoading] = useState(true);

  // Make an authenticated fetch; caller supplies the token explicitly so
  // callbacks created before a token refresh still work.
  const authFetch = useCallback((path, options = {}, tkn = token) =>
    fetch(`${API}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(tkn ? { Authorization: `Bearer ${tkn}` } : {}),
        ...options.headers,
      },
    }),
  [token]);

  // Try to get a new access token from the httpOnly refresh cookie.
  const refresh = useCallback(async () => {
    const res = await fetch(`${API}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return null;
    const { accessToken } = await res.json();
    sessionStorage.setItem("access_token", accessToken);
    setToken(accessToken);
    return accessToken;
  }, []);

  // Load the user profile on mount (or after a token change via AuthCallback).
  useEffect(() => {
    if (!token) { setLoading(false); return; }

    let cancelled = false;
    (async () => {
      let tkn = token;
      let res = await authFetch("/api/users/me", {}, tkn);

      // Token may have expired — try a silent refresh once.
      if (res.status === 401) {
        tkn = await refresh();
        if (!tkn) {
          sessionStorage.removeItem("access_token");
          setToken(null);
          if (!cancelled) setLoading(false);
          return;
        }
        res = await authFetch("/api/users/me", {}, tkn);
      }

      if (!cancelled) {
        if (res.ok) setUser(await res.json());
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [token]); // re-run when AuthCallback stores a new token

  const logout = useCallback(async () => {
    await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" });
    sessionStorage.removeItem("access_token");
    setToken(null);
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (data) => {
    const res = await authFetch("/api/users/me", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const updated = await res.json();
      setUser(updated);
      return { ok: true, user: updated };
    }
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body };
  }, [authFetch]);

  return (
    <AuthContext.Provider value={{ user, token, loading, logout, updateProfile, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
