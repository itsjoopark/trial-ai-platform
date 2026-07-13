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
import { searchRegistries } from "@/lib/registries";
import type { StudyTypeKey } from "@/lib/ctgov";
import { VERDICT_RULES, deriveStatus, metCountOf } from "@/lib/verdict";
import { margaretDemoMatch } from "@/lib/demoMatch";
import type { Trial, TrialMatch, MatchStatus, Criterion, DecisionFactors } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/* --- tuning knobs (logged when they bound coverage; never silent) --- */
const CANDIDATE_POOL = 30; // structural candidates fetched from the registry
const DEEP_REASON_COUNT = 10; // trials we run full Claude reasoning over
const CONCURRENCY = 5; // simultaneous per-trial Claude calls

const SYSTEM = `You are the coordinating agent for Trial, screening one patient against one clinical trial's eligibility criteria.

You are given a structured patient profile and the verbatim inclusion/exclusion text from ClinicalTrials.gov. Segment that text into atomic criteria and judge each against the profile.

${VERDICT_RULES}

For EACH criterion, also set \`provenance\` — where the evidence for your judgment came from (this is descriptive and NEVER changes the verdict):
- "fhir": the profile value you relied on is structured chart data (imported via SMART on FHIR).
- "note": you relied on a clinical narrative/note value.
- "you": you relied on something the patient stated/told us directly.
- "not_documented": nothing in the record addresses this criterion. Use this ONLY together with a "confirm" verdict (it marks the gap the coordinator would otherwise phone to discover).

THEN produce a patient-facing decision brief (the \`brief\` field) to help this person weigh the trial with their care team:
- Write for the reader named in the ADDRESSEE section at the end of this prompt — follow its voice and plain-language rules. Apply the same addressee to the headline field (it overrides any "speak to you" wording in the field schema when the addressee is a caregiver or clinician).
- Ground offers / commitment / uncertainty ONLY in the trial facts given to you (phase, purpose, randomization/masking, interventions, nearest site) and your eligibility findings. Never invent efficacy, outcomes, or benefit.
- Be phase-honest: a Phase 1 study tests safety and dosing and benefit to the patient is unproven; an observational study contributes data and provides no treatment; only later-phase interventional studies test whether a treatment works.
- Non-directive: NEVER tell the patient which trial to choose, or call any trial "best" or "recommended". You frame the decision; the patient and their care team make it.
- BE BRIEF. offers / commitment / uncertainty are each 1–2 short sentences (~30 words, hard cap). Lead with the single most important point and stop. Do NOT restate the trial title, re-explain a drug's mechanism at length, or pad with caveats. Concise beats complete — the reader is scanning three columns side by side.
- questionsToAsk: turn the 'confirm' items and the real uncertainties into 2–3 specific questions this patient should bring to their care team.`;

/* §5.3 — "Who's filling this out?" changes ONLY the addressee/voice of the brief
   and headline. Every eligibility rule (verdicts, citation, fail-closed) is
   identical across entrants. voiceRules() is appended to SYSTEM per request. */
type Entrant = "patient" | "caregiver" | "clinician";
function normalizeEntrant(input?: string): Entrant {
  return input === "caregiver" || input === "clinician" ? input : "patient";
}
function voiceRules(entrant: Entrant): string {
  switch (entrant) {
    case "caregiver":
      return `ADDRESSEE — a family member or caregiver is reading this on behalf of the patient:
- Address the caregiver ABOUT the patient. Refer to the patient as "your loved one" — never invent a name, and never use "you" to mean the patient.
- Keep plain language and gloss any clinical term once. All non-directive, citation, and fail-closed rules apply exactly as stated above.`;
    case "clinician":
      return `ADDRESSEE — a clinician is reading this:
- A clinical register is acceptable; you may use standard oncology terminology WITHOUT glossing it into plain language. Refer to "the patient". Keep it concise and professional.
- All non-directive, citation, and fail-closed rules apply exactly as stated above — voice is the ONLY thing that changes.`;
    default:
      return `ADDRESSEE — the patient is reading this (default voice):
- Address the patient directly as "you". Plain language; gloss any clinical term once.`;
  }
}

type MatchBody = {
  conditionQuery?: string;
  summary?: string;
  fields?: { label: string; value: string }[];
  /** Explicit location captured in the intake survey (city, state, or ZIP). */
  location?: string;
  /** Travel preference: "local" (~25mi) · "regional" (~100mi) · "any". */
  travel?: "local" | "regional" | "any" | null;
  /** Study-type scope chips (§4.1). Applied at the registry before reasoning. */
  studyTypes?: string[];
  /** Who's filling this out (§5.3) — changes the brief/headline voice only. */
  entrant?: string;
  /** Demo hook: the "Try a sample patient (Margaret)" flow sends "margaret" to
   *  get a deterministic, curated result (see lib/demoMatch). Any other input
   *  ignores this and runs the real live pipeline. */
  demo?: string;
};

const VALID_STUDY_TYPES: StudyTypeKey[] = ["treatment", "tests", "observational", "expanded"];
function sanitizeStudyTypes(input?: string[]): StudyTypeKey[] {
  return (input ?? []).filter((s): s is StudyTypeKey => (VALID_STUDY_TYPES as string[]).includes(s));
}

export async function POST(req: Request) {
  let profile: MatchBody;
  try {
    profile = (await req.json()) as MatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Deterministic demo result for the sample patient — instant, always ≥3
  // eligible, no model call. Only this explicit flag triggers it.
  if (profile.demo === "margaret") {
    return NextResponse.json(margaretDemoMatch(profile.summary));
  }

  const cond = (profile.conditionQuery ?? "").trim();
  if (!cond) {
    return NextResponse.json({ error: "conditionQuery is required." }, { status: 400 });
  }

  let pool: Trial[];
  try {
    // §4.1: scope the candidate set at the registry so excluded study types never
    // reach the pool and never consume a Claude reasoning call.
    pool = await searchRegistries({ cond, pageSize: CANDIDATE_POOL, studyTypes: sanitizeStudyTypes(profile.studyTypes) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Trial registry request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const profileText = renderProfile(profile);
  // Prefer the explicitly captured survey location; fall back to any location
  // read out of the note. Distance filtering only bites when we actually have one.
  const patient = derivePatientLoc(profile.fields ?? [], profile.location);
  const travelThr = travelThreshold(profile.travel ?? null);
  const geo: GeoContext = { patient, travelThr };
  const toReason = pool.slice(0, DEEP_REASON_COUNT);
  const screenedOnly = pool.slice(DEEP_REASON_COUNT);

  // Compose the addressee voice (§5.3) onto the base system prompt once per search.
  const system = `${SYSTEM}\n\n${voiceRules(normalizeEntrant(profile.entrant))}`;

  let reasoned: TrialMatch[];
  try {
    const client = anthropic();
    reasoned = await mapPool(toReason, CONCURRENCY, (trial) => reasonTrial(client, system, profileText, trial, geo));
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
    factors: computeFactors(t, geo),
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

  // Location filtering is only meaningful when we have BOTH a patient location
  // and a distance preference — otherwise say so, never imply a filter ran.
  const locationApplied = patient.known && travelThr > 0;
  const location = {
    applied: locationApplied,
    label: (profile.location ?? "").trim(),
    travel: profile.travel ?? null,
    inRange: locationApplied ? reasoned.filter((m) => m.factors.withinRange === true).length : 0,
  };

  return NextResponse.json({ conditionQuery: cond, summary: profile.summary ?? "", counts, location, matches });
}

/* ---- per-trial reasoning ---- */

async function reasonTrial(
  client: ReturnType<typeof anthropic>,
  system: string,
  profileText: string,
  trial: Trial,
  geo: GeoContext,
): Promise<TrialMatch> {
  const factors = computeFactors(trial, geo);

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
    system,
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

  // Status/tally derived from the criteria — fail-closed, explainable. Shared
  // with /api/reconfirm and the client so a resolved "confirm" re-derives the
  // same way it was first computed.
  const status = deriveStatus(criteria);

  return { ...trial, status, headline: ledger?.headline ?? "", criteria, metCount: metCountOf(criteria), total, brief, factors };
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

/** Everything the deterministic geo/proximity layer needs for one search. */
type GeoContext = {
  patient: PatientLoc;
  /** Min proximityScore to count as "within range": 3 local (same city) ·
   *  2 regional (same state) · 0 = no distance filter. */
  travelThr: number;
};

/** Map a travel preference to the minimum proximity score that counts as in-range.
 *  We can only place sites at city/state granularity (no true mileage without
 *  geocoding), so we map conservatively: local (~25mi) → at least same state,
 *  regional (~100mi) → at least same country, any → 0 (no distance filter).
 *  This is what excludes out-of-state trials from a "stay near home" search. */
function travelThreshold(t: "local" | "regional" | "any" | null): number {
  return t === "local" ? 2 : t === "regional" ? 1 : 0;
}

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

/** Pull the patient's location into a token set (city + state name + US state
    abbreviation) for approximate proximity. The explicitly-entered survey
    location wins; profile fields read from the note are a fallback. */
function derivePatientLoc(fields: { label: string; value: string }[], explicit?: string): PatientLoc {
  const fromFields = fields
    .filter((f) => /location|city|state|region|geograph|reside|home/i.test(f.label))
    .map((f) => f.value)
    .join(", ");
  const raw = [explicit ?? "", fromFields].filter(Boolean).join(", ");
  const tokens = new Set<string>();
  for (const part of raw.split(/[,/;]/)) {
    const p = part.trim().toLowerCase().replace(/\./g, "");
    if (!p || /not found|unknown|n\/a|—/.test(p)) continue;
    tokens.add(p);
    for (const w of p.split(/\s+/)) if (w.length >= 2) tokens.add(w);
  }
  // expand state abbreviation ↔ full name in both directions
  let isUS = false;
  for (const t of Array.from(tokens)) {
    if (US_STATES[t]) {
      tokens.add(US_STATES[t]);
      isUS = true;
    }
    if (STATE_ABBR[t]) {
      tokens.add(STATE_ABBR[t]);
      isUS = true;
    }
  }
  // A recognized US state implies the country — otherwise "regional" (country-level)
  // proximity can never match, since the patient rarely types out a country.
  // CT.gov reports US sites with country "United States".
  if (isUS) {
    tokens.add("united states");
    tokens.add("usa");
    tokens.add("us");
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

function computeFactors(trial: Trial, geo: GeoContext): DecisionFactors {
  const { patient, travelThr } = geo;
  let best = 0;
  let nearest = "";
  for (const loc of trial.locations) {
    const score = proximity(loc, patient);
    if (score > best) {
      best = score;
      nearest = siteLabel(loc);
    }
  }
  const hasPlaceableSite = trial.locations.some((l) => l.city || l.state || l.country);
  if (!nearest) nearest = trial.locations[0] ? siteLabel(trial.locations[0]) : "No site listed";

  // withinRange is only a real yes/no when we ran distance filtering (patient
  // location known + a distance preference set). Otherwise it's null = "not filtered".
  const filtering = patient.known && travelThr > 0;
  const withinRange = filtering ? best >= travelThr : null;

  return {
    phaseRank: phaseToRank(trial.phase),
    randomized: trial.randomized || trial.masked,
    interventional: trial.interventional,
    nearestSite: nearest,
    proximityScore: best,
    burdenProxy: burdenProxy(trial),
    withinRange,
    locationUnknown: !hasPlaceableSite,
    enrollmentWindow: enrollmentWindow(trial),
  };
}

/* ---- enrollment window (P1.1) — best-estimate, explicitly labeled ----
   CT.gov has no clean "enrollment close" field. For a recruiting study we know
   enrollment is open now; the primary completion date is the closest published
   upper bound on how long there is to get in. We surface it AS an estimate. */
function enrollmentWindow(trial: Trial): string {
  const recruiting = trial.overallStatus.toUpperCase() === "RECRUITING";
  const bound = trial.primaryCompletionDate || trial.completionDate;
  const boundLabel = fmtMonthYear(bound);
  if (recruiting && boundLabel) return `Open now · est. closes before ~${boundLabel}`;
  if (recruiting) return "Open now · estimated close date not published";
  if (boundLabel) return `Est. closes before ~${boundLabel}`;
  return "";
}

/** "2026-03-31" or "2026-03" → "Mar 2026". Returns "" for empty/malformed input. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtMonthYear(date: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(date.trim());
  if (!m) return "";
  const year = m[1];
  const monthIdx = Number(m[2]) - 1;
  return monthIdx >= 0 && monthIdx < 12 ? `${MONTHS[monthIdx]} ${year}` : year;
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
