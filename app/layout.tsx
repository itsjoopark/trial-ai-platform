import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trial — coordinator clinical trial matcher",
  description:
    "Paste a patient's notes; surface the recruiting ClinicalTrials.gov trials they're eligible for, with the inclusion/exclusion reasoning shown for every match.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Light is the default theme; the in-app toggle stamps data-theme on <html>.
  return (
    <html lang="en" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
