"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth, type Portal } from "@/app/auth-context";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Top-right nav cluster: Log in / Sign up when signed out, a user menu when
 *  signed in. Signup carries the current portal so the form can preselect it. */
export default function NavAuth({ portalMode }: { portalMode: Portal }) {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // close the user menu on Escape or an outside click (modeled on NextStepsPanel)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  if (!user) {
    return (
      <div className="nav-auth">
        <Link href="/login" className="nav-auth__login">
          Log in
        </Link>
        <Link href={`/signup?portal=${portalMode}`} className="nav-auth__signup">
          Sign up
        </Link>
      </div>
    );
  }

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className="user-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="user-menu__avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
      </button>
      {open && (
        <div className="user-menu__panel" role="menu">
          <div className="user-menu__id">
            <span className="user-menu__name">{user.name}</span>
            <span className="user-menu__email">{user.email}</span>
          </div>
          <button
            type="button"
            role="menuitem"
            className="user-menu__item"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
