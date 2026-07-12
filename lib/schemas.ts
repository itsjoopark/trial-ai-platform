/* ============================================================================
   Trial — Zod schemas for Claude structured outputs

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
});

export const ClarificationSchema = z.object({
  id: z.string().describe("Stable kebab-case id for this question."),
  question: z.string().describe("A question whose answer would change which trials qualify. Only ask matching-relevant gaps — never busywork."),
  rationale: z.string().describe("Why this changes a match, in the coordinator's own words (e.g. 'Some studies require imaging within 28 days')."),
  options: z.array(z.string()).describe("2–3 concrete answer options the coordinator can pick from."),
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
});

/* Patient-facing decision brief — grounded in the trial's real attributes and the
   eligibility ledger. Non-directive: it frames the choice, it never makes it. */
export const DecisionBriefSchema = z.object({
  offers: z
    .string()
    .describe(
      "What this trial could offer or is studying, in plain language a patient can read. Frame as POTENTIAL and as what the trial is testing — never a promise of benefit. Be phase-honest: Phase 1 tests safety/dosing and benefit is unproven; an observational study contributes data and provides no treatment. No efficacy claims.",
    ),
  commitment: z
    .string()
    .describe(
      "What the trial asks of the patient, grounded in its design: whether the arm is randomized or placebo/blinding is possible, visits/procedures/biopsies implied, travel to the site, and study length. Concrete and honest.",
    ),
  uncertainty: z
    .string()
    .describe(
      "What is experimental or unknown, appropriate to the phase and design. Name the real uncertainty plainly rather than reassuring.",
    ),
  questionsToAsk: z
    .array(z.string())
    .describe(
      "2–3 specific questions the patient should bring to their care team, drawn from this trial's open items ('confirm' criteria) and uncertainties. Actionable and specific to this trial.",
    ),
});

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
