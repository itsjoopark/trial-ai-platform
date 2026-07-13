/* ============================================================================
   Trialign — Zod schemas for Claude structured outputs

   These constrain what Claude returns (via output_config.format), so the route
   handlers get validated, typed objects rather than free text. Structured
   outputs require every field present (no optionals) and additionalProperties
   false; the SDK's zodOutputFormat() handles the JSON-schema translation.
   ========================================================================== */

import { z } from "zod";

/* ---- /api/extract : free-text note → structured patient profile ---- */

export const ProfileFieldSchema = z.object({
  label: z.string().describe("Short field label, e.g. 'Diagnosis', 'Receptors', 'Biomarkers'."),
  value: z.string().describe("The value read from the note, or a short '— not found in note' when absent."),
  clinical: z
    .boolean()
    .describe("true when the value is raw clinical data (biomarkers, receptors, NCT IDs, dates, ECOG) that should render in monospace."),
  gap: z
    .boolean()
    .describe("true when this datum was NOT present in the note AND matters for matching (renders as a flagged gap)."),
  mcode: z
    .string()
    .describe(
      "The mCODE / US Core profile this field maps to (the federal USCDI+ Cancer Clinical Trials Matching schema), e.g. 'mcode-primary-cancer-condition', 'mcode-tumor-marker-test', 'mcode-genomic-variant', 'mcode-ecog-performance-status'. Empty string when no mCODE/US-Core element applies. Follow the mapping table in the system prompt.",
    ),
  source: z
    .enum(["fhir", "note", "you"])
    .describe(
      "Provenance of this value: 'fhir' = a structured FHIR resource from the patient's chart; 'note' = read from free-text clinical narrative (a pasted/uploaded note or a DocumentReference); 'you' = the patient told us directly. When the input is a plain note with no structured FHIR section, always 'note'.",
    ),
});

export const ClarificationSchema = z.object({
  id: z.string().describe("Stable kebab-case id for this question."),
  question: z.string().describe("A question whose answer would change which trials qualify, addressed to the patient in the second person ('Have you had…'). Only ask matching-relevant gaps — never busywork."),
  rationale: z.string().describe("Why this changes a match, in plain language (e.g. 'Some studies require imaging within 28 days')."),
  gloss: z
    .string()
    .describe(
      "A short plain-language 'what does this mean?' explanation of any clinical term in the question, ~8th-grade reading level (e.g. \"Measurable disease means the cancer shows up on a scan as spots that can be measured\"). Empty string when the question uses no term that needs glossing.",
    ),
  options: z.array(z.string()).describe("2–3 concrete answer options the patient can pick from."),
});

export const ProfileSchema = z.object({
  conditionQuery: z
    .string()
    .describe("The single best ClinicalTrials.gov condition search term for this patient, e.g. 'breast cancer'. Concise; the primary disease, not the full history."),
  summary: z
    .string()
    .describe("One-sentence patient summary in the coordinator's voice, e.g. 'HR+/HER2− metastatic breast cancer, 2 prior lines, ECOG 1.'"),
  fields: z.array(ProfileFieldSchema).describe("The structured profile, one row per clinically meaningful field."),
  clarifications: z
    .array(ClarificationSchema)
    .describe("Only the gaps that actually change which trials qualify. Zero to four. Do not invent questions to fill space."),
});

export type ExtractedProfile = z.infer<typeof ProfileSchema>;

/* ---- /api/match : profile + one trial's eligibility text → criterion ledger ---- */

export const LedgerCriterionSchema = z.object({
  kind: z.enum(["incl", "excl"]).describe("'incl' = inclusion criterion; 'excl' = exclusion criterion."),
  verdict: z
    .enum(["meets", "clear", "confirm", "fails"])
    .describe(
      "meets = inclusion satisfied; clear = exclusion NOT triggered (good); confirm = the record lacks the data to judge — a coordinator to-do, never guessed into a pass or fail; fails = inclusion not met OR exclusion triggered.",
    ),
  requirement: z.string().describe("The atomic requirement, in plain clinical language."),
  evidence: z
    .string()
    .describe("The 'why', citing the patient record in the coordinator's words (e.g. 'Palbociclib (1L) — progressed Dec 2025'). Empty string only when there is genuinely nothing to cite."),
  provenance: z
    .enum(["fhir", "note", "you", "not_documented"])
    .describe(
      "Where the evidence for THIS judgment came from: 'fhir' = a structured FHIR resource from the chart; 'note' = a clinical narrative/note; 'you' = the patient told us directly; 'not_documented' = nothing in the record addresses this criterion (use this ONLY with a 'confirm' verdict). This is descriptive provenance — it does not change the verdict.",
    ),
});

/* Patient-facing decision brief — grounded in the trial's real attributes and the
   eligibility ledger. Non-directive: it frames the choice, it never makes it. */
export const DecisionBriefSchema = z.object({
  offers: z
    .string()
    .describe(
      "What this trial could offer or is studying, in plain language a patient can read. Frame as POTENTIAL and as what the trial is testing — never a promise of benefit. Be phase-honest: Phase 1 tests safety/dosing and benefit is unproven; an observational study contributes data and provides no treatment. No efficacy claims. Keep it tight: 1–2 short sentences, ~30 words max (hard cap) — lead with the essential and stop.",
    ),
  commitment: z
    .string()
    .describe(
      "What the trial asks of the patient, grounded in its design: whether the arm is randomized or placebo/blinding is possible, visits/procedures/biopsies implied, travel to the site, and study length. Concrete and honest. Keep it tight: 1–2 short sentences, ~30 words max (hard cap) — the most demanding asks only.",
    ),
  uncertainty: z
    .string()
    .describe(
      "What is experimental or unknown, appropriate to the phase and design. Name the real uncertainty plainly rather than reassuring. Keep it tight: 1–2 short sentences, ~30 words max (hard cap) — the single biggest open question first.",
    ),
  questionsToAsk: z
    .array(z.string())
    .describe(
      "2–3 specific questions the patient should bring to their care team, drawn from this trial's open items ('confirm' criteria) and uncertainties. Actionable and specific to this trial.",
    ),
});

/* ---- /api/reconfirm : one criterion + the patient's added info → a fresh verdict ----
   When a patient resolves a "confirm" (or when their new info is re-checked against
   another trial's open items), we re-judge just those criteria — same verdict rules,
   same fail-closed honesty. The array is returned in the same order it was sent. */
export const ReverdictSchema = z.object({
  verdict: z
    .enum(["meets", "clear", "confirm", "fails"])
    .describe(
      "The re-judged verdict for this one criterion given the patient's added info. Still 'confirm' if the info is not enough to decide — never guessed into a pass or a fail.",
    ),
  evidence: z
    .string()
    .describe("The 'why', citing the patient's added info and record in plain words. Empty string only when there is genuinely nothing to cite."),
});

export const ReconfirmSchema = z.object({
  verdicts: z.array(ReverdictSchema).describe("One re-judged verdict per input criterion, in the SAME order the criteria were given."),
});

export type ExtractedReconfirm = z.infer<typeof ReconfirmSchema>;

/* ---- /api/fork-options : profile → plausible next treatment lines (PRD §6.2) ----
   The Fork generates the enumerable next lines FROM the note (a Clarify-style card,
   never a free-text box). The two fixed options ("Nothing decided yet", "Something
   else") are appended in code by the route, not produced by the model. */
export const ForkOptionSchema = z.object({
  id: z.string().describe("Stable kebab-case id, e.g. 'capivasertib-fulvestrant'."),
  label: z.string().describe("The treatment line in plain language, e.g. 'Capivasertib + fulvestrant'."),
  drugClass: z
    .string()
    .describe("Short mechanism gloss a patient can read, e.g. 'AKT inhibitor + hormone therapy'. One phrase, no efficacy claims."),
  rationale: z
    .string()
    .describe("Why this line is plausible for THIS patient, grounded in the note (biomarker, prior lines, receptor status). One sentence."),
});

export const ForkOptionsSchema = z.object({
  options: z
    .array(ForkOptionSchema)
    .describe(
      "The plausible NEXT treatment lines for this patient given the note — typically 3 to 6. Standard-of-care next lines for the disease/biomarker/prior-therapy context. Do not invent exotic options; do not include anything the note rules out. Order by clinical plausibility.",
    ),
});

export type ExtractedForkOptions = z.infer<typeof ForkOptionsSchema>;

/* ---- /api/fork : one hypothetical next treatment × the already-reasoned trials ----
   The payoff (PRD §6.3). We REUSE each trial's existing criterion ledger — we do
   NOT redo full eligibility reasoning. For a chosen next treatment, judge whether
   each currently-open trial STAYS OPEN or CLOSES, and cite the exact inclusion/
   exclusion criterion that drives the call. Fail closed: if the record can't
   support the call, it's "confirm" — never guessed either way. */
export const ForkDoorSchema = z.object({
  nctId: z.string().describe("The trial this verdict is for — echo the NCT id exactly as given."),
  door: z
    .enum(["stays_open", "closes", "confirm"])
    .describe(
      "stays_open = starting this treatment does NOT trip any criterion, the trial remains an option. closes = starting it would newly TRIGGER an exclusion or VIOLATE an inclusion (e.g. a prior-AKT-inhibitor exclusion, a max-prior-lines cap). confirm = the record genuinely can't support the call — never guess a door either way.",
    ),
  criterion: z
    .string()
    .describe(
      "The specific inclusion/exclusion criterion (verbatim from this trial's ledger) that drives the call. For 'closes', the criterion the treatment would trip. Empty string only when 'stays_open' with genuinely no criterion implicated.",
    ),
  kind: z.enum(["incl", "excl"]).describe("Whether the cited criterion is an inclusion or exclusion criterion."),
  reason: z
    .string()
    .describe("One plain-language line tying the treatment to that criterion, e.g. 'Capivasertib is an AKT inhibitor, which this trial excludes.' No efficacy or benefit claims."),
});

export const ForkResultSchema = z.object({
  doors: z
    .array(ForkDoorSchema)
    .describe("One door verdict per input trial, in the SAME order the trials were given. Do not add, drop, or reorder."),
});

export type ExtractedForkResult = z.infer<typeof ForkResultSchema>;

export const LedgerSchema = z.object({
  headline: z
    .string()
    .describe("One line, addressed to the patient in plain language: why this could be a fit, or what rules it out. No 'she/the patient' — speak to 'you'."),
  criteria: z
    .array(LedgerCriterionSchema)
    .describe(
      "Every criterion you can extract from the eligibility text that is relevant to this patient. For a near-miss, list EVERY failing criterion — never stop at the first. Fail closed.",
    ),
  brief: DecisionBriefSchema.describe(
    "A patient-facing decision brief for this trial. If the patient clearly does not qualify (a near-miss), keep it short and focus on what would rule it in or out. Never tell the patient what to choose.",
  ),
});

export type ExtractedLedger = z.infer<typeof LedgerSchema>;
