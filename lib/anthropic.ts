/* ============================================================================
   Trialign — Anthropic client

   One place to construct the client and pin the model. The key is read from
   ANTHROPIC_API_KEY (env). We default to Claude Opus 4.8 — the eligibility
   calls are the trust surface, so we use the most capable model for both
   extraction and per-criterion reasoning.
   ========================================================================== */

import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-4-8";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.example) locally, " +
        "or to Vercel → Project → Settings → Environment Variables in production.",
    );
  }
  if (!client) client = new Anthropic();
  return client;
}
