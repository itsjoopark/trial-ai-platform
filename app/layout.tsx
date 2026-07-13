import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trial — demo clinical trial matcher",
  description:
    "Research prototype. Describe your situation and see recruiting ClinicalTrials.gov studies you may be eligible for, with the reasoning behind every match. Not medical advice; synthetic data only.",
  icons: { icon: "/images/trial-logo.png", apple: "/images/trial-logo.png" },
  // Consent-flow-spec §1.1 — the demo must not be publicly discoverable/indexed.
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Light is the default theme; the in-app toggle stamps data-theme on <html>.
  return (
    <html lang="en" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
