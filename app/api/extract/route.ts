/* ============================================================================
   POST /api/extract  —  free-text patient note → structured profile

   Seam #1 from the prototype (NOTE / FIELDS). Claude reads a messy note into a
   structured profile and surfaces only the gaps that actually change which
   trials qualify. Runs server-side so the API key never reaches the browser.
   ========================================================================== */

import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, MODEL } from "@/lib/anthropic";
import { ProfileSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are the coordinating agent for Trial, a clinical-trial matcher used by a research coordinator screening a single patient.

Read the patient note into a structured profile. Rules:
- Use the coordinator's vocabulary, not the system's. Be specific and honest.
- Set clinical:true for raw clinical data (biomarkers, receptors, NCT IDs, dates, ECOG, stage) — it renders in monospace.
- Set gap:true ONLY for a field that is missing from the note AND would gate matching (e.g. a recent scan date, adequate organ function). Do not invent gaps.
- clarifications: ask only questions whose answer changes which trials qualify. Zero is a valid answer. Never pad with busywork. Prefer "insufficient info — confirm X" over false precision.
- conditionQuery must be a concise ClinicalTrials.gov condition term (the primary disease), e.g. "breast cancer" — not the whole history.

This is informational decision support for a coordinator's review, and demo data is synthetic. Never fabricate values that are not in the note.`;

export async function POST(req: Request) {
  let note: string;
  try {
    const body = (await req.json()) as { note?: string };
    note = (body.note ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!note) {
    return NextResponse.json({ error: "A patient note is required." }, { status: 400 });
  }

  try {
    const client = anthropic();
    const msg = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      output_config: { format: zodOutputFormat(ProfileSchema) },
      messages: [{ role: "user", content: `Patient note:\n\n${note}` }],
    });

    const profile = msg.parsed_output;
    if (!profile) {
      return NextResponse.json({ error: "The model did not return a parseable profile." }, { status: 502 });
    }
    return NextResponse.json({ profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed.";
    const status = message.includes("ANTHROPIC_API_KEY") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
