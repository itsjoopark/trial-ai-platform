/* ============================================================================
   POST /api/match  —  profile → ranked trials with per-criterion ledgers

   Seam #3 (retrieve → segment → reason). The trust surface of the product.

   1. Fetch a pool of recruiting trials for the profile's condition (live).
   2. Deep-reason the top DEEP_REASON_COUNT with Claude, one call per trial,
      at bounded concurrency: segment the eligibility prose into atomic
      criteria and judge each against the profile.
   3. The rest are returned as "screened — not yet reasoned" so nothing is
      silently dropped.

   Trust invariants enforced here, not left to the model:
   - Overall status is DERIVED from the criteria (fail-closed), never taken
     from a model's self-report (rank on explainable signal only).
   - "confirm" (insufficient info) is a first-class verdict — a coordinator
     to-do, never guessed into a pass or fail.
   ========================================================================== */

import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, MODEL } from "@/lib/anthropic";
import { LedgerSchema } from "@/lib/schemas";
import { searchTrials } from "@/lib/ctgov";
import type { Trial, TrialMatch, MatchStatus, Criterion } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/* --- tuning knobs (logged when they bound coverage; never silent) --- */
const CANDIDATE_POOL = 30; // structural candidates fetched from the registry
const DEEP_REASON_COUNT = 10; // trials we run full Claude reasoning over
const CONCURRENCY = 5; // simultaneous per-trial Claude calls

const SYSTEM = `You are the coordinating agent for Trial, screening one patient against one clinical trial's eligibility criteria.

You are given a structured patient profile and the verbatim inclusion/exclusion text from ClinicalTrials.gov. Segment that text into atomic criteria and judge each against the profile.

Verdict rules (this is the product's meaning system — be exact):
- meets  : an INCLUSION criterion the patient satisfies. Cite the evidence.
- clear  : an EXCLUSION criterion that is NOT triggered (good for the patient).
- confirm: the record genuinely lacks the data to judge this criterion. Say so — never guess it into a pass or a fail. This becomes a coordinator to-do (e.g. "confirm RECIST measurability", "confirm HbA1c").
- fails  : an INCLUSION criterion the patient does not meet, OR an EXCLUSION criterion that IS triggered.

Hard requirements:
- Fail closed. If the patient is a near-miss, list EVERY failing criterion, not just the first. A false "so close" is worse than a clean no.
- Cite the record in the coordinator's words in the evidence field. Bold the specific value that drove the call is not needed — just be concrete.
- Do not invent patient data. If the profile is silent on something a criterion needs, that criterion is "confirm", not a pass.
- Keep requirements atomic and in plain clinical language.`;

export async function POST(req: Request) {
  let profile: { conditionQuery?: string; summary?: string; fields?: { label: string; value: string }[] };
  try {
    profile = (await req.json()) as typeof profile;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const cond = (profile.conditionQuery ?? "").trim();
  if (!cond) {
    return NextResponse.json({ error: "conditionQuery is required." }, { status: 400 });
  }

  let pool: Trial[];
  try {
    pool = await searchTrials({ cond, pageSize: CANDIDATE_POOL });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ClinicalTrials.gov request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const profileText = renderProfile(profile);
  const toReason = pool.slice(0, DEEP_REASON_COUNT);
  const screenedOnly = pool.slice(DEEP_REASON_COUNT);

  let reasoned: TrialMatch[];
  try {
    const client = anthropic();
    reasoned = await mapPool(toReason, CONCURRENCY, (trial) => reasonTrial(client, profileText, trial));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reasoning failed.";
    const status = message.includes("ANTHROPIC_API_KEY") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }

  // Rank the reasoned trials on explainable signal only: eligible first, then
  // by criteria-met ratio. Never on a model's self-reported confidence.
  const rank: Record<MatchStatus, number> = { eligible: 0, uncertain: 1, near: 2, screened: 3 };
  reasoned.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return ratio(b) - ratio(a);
  });

  const screened: TrialMatch[] = screenedOnly.map((t) => ({
    ...t,
    status: "screened" as const,
    headline: "Passed structural gates — not yet reasoned in this pass.",
    criteria: [],
    metCount: 0,
    total: 0,
  }));

  const matches = [...reasoned, ...screened];
  const counts = {
    poolTotal: pool.length,
    reasoned: reasoned.length,
    eligible: reasoned.filter((m) => m.status === "eligible").length,
    uncertain: reasoned.filter((m) => m.status === "uncertain").length,
    near: reasoned.filter((m) => m.status === "near").length,
    screened: screened.length,
  };

  return NextResponse.json({ conditionQuery: cond, summary: profile.summary ?? "", counts, matches });
}

/* ---- per-trial reasoning ---- */

async function reasonTrial(
  client: ReturnType<typeof anthropic>,
  profileText: string,
  trial: Trial,
): Promise<TrialMatch> {
  // No eligibility text → nothing to reason over; surface as screened rather
  // than burning a call on an empty prompt.
  if (!trial.eligibilityCriteria.trim()) {
    return { ...trial, status: "screened", headline: "No eligibility text published.", criteria: [], metCount: 0, total: 0 };
  }

  const msg = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    output_config: { format: zodOutputFormat(LedgerSchema) },
    messages: [
      {
        role: "user",
        content:
          `PATIENT PROFILE\n${profileText}\n\n` +
          `TRIAL ${trial.nctId} — ${trial.title}\n` +
          `Phase ${trial.phase} · ${trial.sponsor}\n\n` +
          `ELIGIBILITY CRITERIA (verbatim from ClinicalTrials.gov)\n${trial.eligibilityCriteria}`,
      },
    ],
  });

  const ledger = msg.parsed_output ?? { headline: "", criteria: [] as Criterion[] };
  const criteria = ledger.criteria as Criterion[];
  const total = criteria.length;
  const metCount = criteria.filter((c) => c.verdict === "meets" || c.verdict === "clear").length;

  // Status derived from the criteria — fail-closed, explainable.
  const hasFail = criteria.some((c) => c.verdict === "fails");
  const hasConfirm = criteria.some((c) => c.verdict === "confirm");
  const status: MatchStatus = total === 0 ? "screened" : hasFail ? "near" : hasConfirm ? "uncertain" : "eligible";

  return { ...trial, status, headline: ledger.headline, criteria, metCount, total };
}

/* ---- helpers ---- */

function renderProfile(profile: { summary?: string; fields?: { label: string; value: string }[] }): string {
  const lines: string[] = [];
  if (profile.summary) lines.push(profile.summary, "");
  for (const f of profile.fields ?? []) lines.push(`${f.label}: ${f.value}`);
  return lines.join("\n");
}

function ratio(m: TrialMatch): number {
  return m.total === 0 ? 0 : m.metCount / m.total;
}

/** Run fn over items with at most `limit` in flight; preserves input order. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}
