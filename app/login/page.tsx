"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import TrialLogo from "@/app/components/TrialLogo";
import { useAuth } from "@/app/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { user, mounted, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // already signed in → nothing to do here
  useEffect(() => {
    if (mounted && user) router.replace("/");
  }, [mounted, user, router]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    signIn(email, password);
    router.push("/");
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <Link href="/" className="auth-brand" aria-label="Trial home">
          <TrialLogo />
          <span>Trial</span>
        </Link>
        <h1>Welcome back</h1>
        <p className="auth-sub">Log in to your Trial account.</p>

        <form className="auth-form" onSubmit={onSubmit} noValidate>
          <label className="auth-field">
            <span>Email</span>
            <input
              className="auth-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              className="auth-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="btn go auth-submit">
            Log in
          </button>
        </form>

        <p className="auth-alt">
          New to Trial? <Link href="/signup">Create an account</Link>
        </p>
        <p className="auth-demo-note">Demo sign-in — any email and password are accepted; no real account or data is created.</p>
        <Link href="/" className="auth-back">
          ← Back to home
        </Link>
      </div>
    </main>
  );
}
