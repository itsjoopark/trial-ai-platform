import type { Metadata } from "next";
import { Manrope, Newsreader } from "next/font/google";
import { AuthProvider } from "./auth-context";
import "./globals.css";

// Trial design system (design.md §4). Manrope is the app-wide sans; loaded as a
// variable font so the app's in-between weights (560/640/680) render true.
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});
// Newsreader italic — editorial serif for emphasis inside display headlines.
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["italic"],
  variable: "--font-newsreader",
  display: "swap",
});

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
    <html lang="en" data-theme="light" className={`${manrope.variable} ${newsreader.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
