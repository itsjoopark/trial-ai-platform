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
import type { Trial, TrialMatch, MatchStatus, Criterion, DecisionFactors } from "@/lib/types";

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
- Keep requirements atomic and in plain clinical language.

THEN produce a patient-facing decision brief (the \`brief\` field) to help this person weigh the trial with their care team:
- Write for the PATIENT, in plain language — not clinical shorthand or abbreviations.
- Ground offers / commitment / uncertainty ONLY in the trial facts given to you (phase, purpose, randomization/masking, interventions, nearest site) and your eligibility findings. Never invent efficacy, outcomes, or benefit.
- Be phase-honest: a Phase 1 study tests safety and dosing and benefit to the patient is unproven; an observational study contributes data and provides no treatment; only later-phase interventional studies test whether a treatment works.
- Non-directive: NEVER tell the patient which trial to choose, or call any trial "best" or "recommended". You frame the decision; the patient and their care team make it.
- questionsToAsk: turn the 'confirm' items and the real uncertainties into 2–3 specific questions this patient should bring to their care team.`;

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
  const patient = derivePatientLoc(profile.fields ?? []);
  const toReason = pool.slice(0, DEEP_REASON_COUNT);
  const screenedOnly = pool.slice(DEEP_REASON_COUNT);

  let reasoned: TrialMatch[];
  try {
    const client = anthropic();
    reasoned = await mapPool(toReason, CONCURRENCY, (trial) => reasonTrial(client, profileText, trial, patient));
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
    brief: null,
    factors: computeFactors(t, patient),
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
  patient: PatientLoc,
): Promise<TrialMatch> {
  const factors = computeFactors(trial, patient);

  // No eligibility text → nothing to reason over; surface as screened rather
  // than burning a call on an empty prompt.
  if (!trial.eligibilityCriteria.trim()) {
    return { ...trial, status: "screened", headline: "No eligibility text published.", criteria: [], metCount: 0, total: 0, brief: null, factors };
  }

  const design =
    `Design: ${trial.randomized ? "randomized" : "non-randomized"}, ` +
    `${trial.masked ? "blinded/masked (placebo or unknown arm possible)" : "open-label"}` +
    `${trial.enrollment ? `, ~${trial.enrollment} participants` : ""}`;
  const interventions = trial.interventions.length
    ? trial.interventions.map((i) => (i.type ? `${i.name} (${i.type})` : i.name)).join("; ")
    : "—";

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
          `Phase ${trial.phase} · ${trial.studyType}${trial.primaryPurpose ? ` · ${trial.primaryPurpose}` : ""} · ${trial.sponsor}\n` +
          `${design}\n` +
          `Interventions: ${interventions}\n` +
          `Nearest site to the patient: ${factors.nearestSite}\n\n` +
          `ELIGIBILITY CRITERIA (verbatim from ClinicalTrials.gov)\n${trial.eligibilityCriteria}`,
      },
    ],
  });

  const ledger = msg.parsed_output;
  const criteria = (ledger?.criteria ?? []) as Criterion[];
  const brief = ledger?.brief ?? null;
  const total = criteria.length;
  const metCount = criteria.filter((c) => c.verdict === "meets" || c.verdict === "clear").length;

  // Status derived from the criteria — fail-closed, explainable.
  const hasFail = criteria.some((c) => c.verdict === "fails");
  const hasConfirm = criteria.some((c) => c.verdict === "confirm");
  const status: MatchStatus = total === 0 ? "screened" : hasFail ? "near" : hasConfirm ? "uncertain" : "eligible";

  return { ...trial, status, headline: ledger?.headline ?? "", criteria, metCount, total, brief, factors };
}

/* ---- helpers ---- */

function renderProfile(profile: { summary?: string; fields?: { label: string; value: string }[] }): string {
  const lines: string[] = [];
  if (profile.summary) lines.push(profile.summary, "");
  for (const f of profile.fields ?? []) lines.push(`${f.label}: ${f.value}`);
  return lines.join("\n");
}

/* ---- decision factors (deterministic — computed in code, never from the model) ---- */

type PatientLoc = { tokens: Set<string>; known: boolean };

const US_STATES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
  co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
  hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
  ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri",
  mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey",
  nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio",
  ok: "oklahoma", or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina",
  sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont",
  va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
  dc: "district of columbia",
};
const STATE_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([abbr, name]) => [name, abbr]),
);

/** Pull the patient's location from the profile fields into a token set
    (city + state name + US state abbreviation) for approximate proximity. */
function derivePatientLoc(fields: { label: string; value: string }[]): PatientLoc {
  const raw = fields
    .filter((f) => /location|city|state|region|geograph|reside|home/i.test(f.label))
    .map((f) => f.value)
    .join(", ");
  const tokens = new Set<string>();
  for (const part of raw.split(/[,/;]/)) {
    const p = part.trim().toLowerCase().replace(/\./g, "");
    if (!p || /not found|unknown|n\/a|—/.test(p)) continue;
    tokens.add(p);
    for (const w of p.split(/\s+/)) if (w.length >= 2) tokens.add(w);
  }
  // expand state abbreviation ↔ full name in both directions
  for (const t of Array.from(tokens)) {
    if (US_STATES[t]) tokens.add(US_STATES[t]);
    if (STATE_ABBR[t]) tokens.add(STATE_ABBR[t]);
  }
  return { tokens, known: tokens.size > 0 };
}

type LocLike = { city: string; state: string; country: string };

function siteLabel(loc: LocLike): string {
  const place = [loc.city, loc.state].filter(Boolean).join(", ");
  return place || loc.country || "Site";
}

/** 3 same city · 2 same state · 1 same country · 0 unknown/none. Approximate. */
function proximity(loc: LocLike, patient: PatientLoc): number {
  if (!patient.known) return 0;
  const city = loc.city.trim().toLowerCase();
  const state = loc.state.trim().toLowerCase();
  const country = loc.country.trim().toLowerCase();
  if (city && patient.tokens.has(city)) return 3;
  if (state && (patient.tokens.has(state) || (STATE_ABBR[state] && patient.tokens.has(STATE_ABBR[state])))) return 2;
  if (country && patient.tokens.has(country)) return 1;
  return 0;
}

function phaseToRank(phase: string): number {
  const p = phase.toLowerCase();
  if (p.includes("4")) return 4;
  if (p.includes("3")) return 3;
  if (p.includes("2")) return 2;
  if (p.includes("1")) return 1;
  return 0; // N/A or observational
}

/** Rough burden estimate: observational = low; early-phase interventional = higher. */
function burdenProxy(trial: Trial): number {
  if (!trial.interventional) return 0;
  return phaseToRank(trial.phase) <= 1 ? 2 : 1;
}

function computeFactors(trial: Trial, patient: PatientLoc): DecisionFactors {
  let best = 0;
  let nearest = "";
  for (const loc of trial.locations) {
    const score = proximity(loc, patient);
    if (score > best) {
      best = score;
      nearest = siteLabel(loc);
    }
  }
  if (!nearest) nearest = trial.locations[0] ? siteLabel(trial.locations[0]) : "No site listed";
  return {
    phaseRank: phaseToRank(trial.phase),
    randomized: trial.randomized || trial.masked,
    interventional: trial.interventional,
    nearestSite: nearest,
    proximityScore: best,
    burdenProxy: burdenProxy(trial),
  };
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
