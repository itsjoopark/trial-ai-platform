/* ============================================================================
   Trial — shared domain types

   These describe the data that flows between the server route handlers and the
   React UI. The Zod schemas in schemas.ts describe what Claude is asked to
   return; the types here describe what the UI consumes after normalization.
   ========================================================================== */

/** One recruiting site for a trial, pulled live from ClinicalTrials.gov. */
export type TrialLocation = {
  facility: string;
  city: string;
  state: string;
  country: string;
  status: string;
};

/** A trial normalized from a ClinicalTrials.gov v2 study record. */
export type Trial = {
  nctId: string;
  title: string;
  officialTitle: string;
  phase: string; // "Phase 2", "Phase 1/2", "N/A", …
  studyType: string;
  overallStatus: string; // "RECRUITING"
  sponsor: string;
  conditions: string[];
  /** Raw inclusion/exclusion prose — the raw material for the criterion ledger. */
  eligibilityCriteria: string;
  sex: string;
  minimumAge: string;
  stdAges: string[];
  locations: TrialLocation[];
  /** Deep link to the study on ClinicalTrials.gov. */
  url: string;
};

/** A single criterion verdict in the ledger.
 *  meets/clear satisfy; confirm = insufficient info (a coordinator to-do);
 *  fails = not met. "clear" is an exclusion that is NOT triggered. */
export type Verdict = "meets" | "clear" | "confirm" | "fails";

export type Criterion = {
  kind: "incl" | "excl";
  verdict: Verdict;
  requirement: string;
  evidence: string;
};

/** Overall standing of a trial for this patient. "screened" = passed structural
 *  gates but not yet reasoned over (we deep-reason the top N per search). */
export type MatchStatus = "eligible" | "near" | "uncertain" | "screened";

/** A trial plus its per-criterion reasoning — what the results screen renders. */
export type TrialMatch = Trial & {
  status: MatchStatus;
  headline: string;
  criteria: Criterion[];
  metCount: number;
  total: number;
};
