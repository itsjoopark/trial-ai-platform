"use client";

/* ============================================================================
   Mock auth — a front-end-only session facade for the demo.

   There is NO backend: "accounts" live in localStorage under the trial: prefix
   (mirroring pickWelcomeGreeting in page.tsx). Log-in is mock-accept — any
   email/password is honored. NO passwords are ever stored. This exists to
   design the signed-in experience; a real provider (Clerk/NextAuth/Supabase)
   would replace AuthProvider without touching consumers (useAuth stays stable).
   Do NOT model real credential handling on this.
   ========================================================================== */

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Portal = "patient" | "clinician" | "partner";

export type User = {
  name: string;
  email: string;
  portal: Portal;
};

type AuthValue = {
  user: User | null;
  /** false until the client has read localStorage — lets the nav avoid a
   *  logged-out flash / hydration mismatch on first paint. */
  mounted: boolean;
  signUp: (name: string, email: string, password: string, portal: Portal) => User;
  signIn: (email: string, password: string) => User;
  signOut: () => void;
};

const USER_KEY = "trial:user";
const REGISTRY_KEY = "trial:users";

const AuthContext = createContext<AuthValue | null>(null);

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / storage disabled — session stays in-memory only */
  }
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] || "there";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setUser(read<User>(USER_KEY));
    setMounted(true);
  }, []);

  const signUp = useCallback((name: string, email: string, password: string, portal: Portal): User => {
    const u: User = { name: name.trim() || nameFromEmail(email), email: email.trim(), portal };
    // keep a lightweight registry so a later log-in "remembers" name + portal
    const registry = read<User[]>(REGISTRY_KEY) ?? [];
    const next = [...registry.filter((r) => r.email !== u.email), u];
    write(REGISTRY_KEY, next);
    write(USER_KEY, u);
    setUser(u);
    return u;
  }, []);

  const signIn = useCallback((email: string, _password: string): User => {
    const registry = read<User[]>(REGISTRY_KEY) ?? [];
    const known = registry.find((r) => r.email === email.trim());
    // mock-accept: known accounts restore their profile; unknown emails get a
    // minimal session (this is a demo facade, not real authentication)
    const u: User = known ?? { name: nameFromEmail(email), email: email.trim(), portal: "patient" };
    write(USER_KEY, u);
    setUser(u);
    return u;
  }, []);

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, mounted, signUp, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
