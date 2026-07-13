/* ============================================================================
   POST /api/fork-options  —  the patient profile → plausible next treatment lines

   The Fork (intake-prd §6.2). After Results, we ask "has your care team
   recommended what's next? Some treatments close doors." — and the options are
   GENERATED FROM THE NOTE, not typed into a box. Enumerating the plausible next
   lines *is the demo*: for HR+/HER2−, PIK3CA H1047R+, post-letrozole/palbo,
   post-fulvestrant, the next lines are capivasertib+fulvestrant, alpelisib+
   fulvestrant, everolimus+exemestane, chemo, T-DXd.

   Two options are ALWAYS appended in code (never from the model):
   - "Nothing decided yet — show me what each option would cost me" (the visual
     default: it opens the full decision tree instead of committing to a branch).
   - "Something else" (a single line of free text).
   ========================================================================== */

import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, MODEL } from "@/lib/anthropic";
import { ForkOptionsSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

/* The two fixed options, appended in code (PRD §6.2). kind drives UI behavior:
   "all" = run the tree over every generated option; "other" = free-text line. */
export const FORK_FIXED = {
  nothingDecided: {
    id: "nothing-decided",
    label: "Nothing decided yet — show me what each option would cost me",
    drugClass: "",
    rationale: "See the full decision tree across every plausible next line.",
    kind: "all" as const,
  },
  somethingElse: {
    id: "something-else",
    label: "Something else",
    drugClass: "",
    rationale: "Enter a treatment your care team mentioned.",
    kind: "other" as const,
  },
};

const SYSTEM = `You are the coordinating agent for Trial. Given one patient's profile (read from their own note), enumerate the PLAUSIBLE NEXT LINES OF TREATMENT for them — the standard-of-care options an oncologist would realistically weigh next.

Rules:
- Ground every option in THIS patient's note: disease + subtype, biomarkers, receptor status, and what they have already had. Do not propose a line the note has already exhausted or ruled out.
- These are the enumerable next lines, not exotic possibilities. Typically 3 to 6.
- drugClass is a one-phrase plain-language mechanism gloss (e.g. "AKT inhibitor + hormone therapy") — no efficacy or benefit claims, ever.
- rationale is one sentence on why it's plausible for this specific patient (biomarker/prior-line context).
- This is informational support for a conversation with the patient's care team — never advice, never a recommendation, never "best". You are laying out the menu, not choosing from it.

Example (HR+/HER2− metastatic breast cancer, PIK3CA H1047R+, post-letrozole/palbociclib, post-fulvestrant): capivasertib + fulvestrant; alpelisib + fulvestrant; everolimus + exemestane; chemotherapy (e.g. capecitabine); trastuzumab deruxtecan (T-DXd).`;

type Body = { profile?: { summary?: string; fields?: { label: string; value: string }[] } };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const profileText = renderProfile(body.profile ?? {});
  if (!profileText.trim()) {
    return NextResponse.json({ error: "A patient profile is required." }, { status: 400 });
  }

  try {
    const client = anthropic();
    const msg = await client.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      output_config: { format: zodOutputFormat(ForkOptionsSchema) },
      messages: [{ role: "user", content: `PATIENT PROFILE\n${profileText}` }],
    });

    const generated = (msg.parsed_output?.options ?? []).map((o) => ({ ...o, kind: "treatment" as const }));
    // Append the two fixed options in code — never from the model.
    const options = [...generated, FORK_FIXED.nothingDecided, FORK_FIXED.somethingElse];
    return NextResponse.json({ options });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not generate options.";
    const status = message.includes("ANTHROPIC_API_KEY") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

function renderProfile(profile: { summary?: string; fields?: { label: string; value: string }[] }): string {
  const lines: string[] = [];
  if (profile.summary) lines.push(profile.summary, "");
  for (const f of profile.fields ?? []) lines.push(`${f.label}: ${f.value}`);
  return lines.join("\n");
}
