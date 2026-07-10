import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Trial is a self-contained app: a React UI plus server route handlers that
  // proxy ClinicalTrials.gov and call the Anthropic API. No special config needed;
  // Vercel auto-detects Next.js at the repo root.
};

export default nextConfig;
