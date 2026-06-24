"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { APP_SCREENS, canAccessScreen } from "@/lib/screens";

// Premier écran accessible à l'utilisateur (le dashboard n'est pas garanti :
// certains comptes n'y ont pas accès). Repli sur /account (toujours accessible).
export function firstAllowedScreen(role: string, screenAccess: string[] | null): string {
  return APP_SCREENS.find((s) => canAccessScreen(role, screenAccess, s.key))?.key ?? "/account";
}

interface AuthUser {
  id: string;
  name: string;
  role: string;
  screenAccess: string[] | null;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (code: string) => Promise<{ error?: string }>;
  logout: (opts?: { reason?: "inactivity" }) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => ({}),
  logout: async () => {},
  refresh: async () => {},
});

// Déconnexion automatique après ce délai SANS activité (sécurité : un compte ne
// reste pas ouvert indéfiniment sur une machine laissée sans surveillance).
const INACTIVITY_MS = 4 * 60 * 60 * 1000; // 4 heures

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (code: string) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || "Erreur de connexion" };
      setUser(data.user);
      router.push(firstAllowedScreen(data.user.role, data.user.screenAccess));
      return {};
    } catch {
      return { error: "Erreur réseau" };
    }
  };

  const logout = useCallback(
    async (opts?: { reason?: "inactivity" }) => {
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      setUser(null);
      router.push(opts?.reason === "inactivity" ? "/login?expired=1" : "/login");
    },
    [router]
  );

  // Déconnexion sur inactivité — actif uniquement quand un utilisateur est connecté.
  const lastActivityRef = useRef(Date.now());
  useEffect(() => {
    if (!user) return;
    lastActivityRef.current = Date.now();

    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };
    const activityEvents = ["mousedown", "keydown", "touchstart", "scroll", "mousemove"];
    activityEvents.forEach((e) =>
      window.addEventListener(e, markActivity, { passive: true })
    );

    // Vérifie périodiquement ET au retour sur l'onglet (capte une veille / longue absence,
    // pendant laquelle les minuteurs JS sont suspendus).
    const check = () => {
      if (Date.now() - lastActivityRef.current > INACTIVITY_MS) {
        logout({ reason: "inactivity" });
      }
    };
    const interval = setInterval(check, 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      activityEvents.forEach((e) => window.removeEventListener(e, markActivity));
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [user, logout]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
