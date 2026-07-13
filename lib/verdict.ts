/* ============================================================================
   Trial — the verdict meaning system (single source of truth)

   The verdict triad (meets/clear/confirm/fails) and the fail-closed derivation
   of a trial's overall status are the product's trust surface. They must read
   identically everywhere they are applied:
     - /api/match      : first-pass reasoning over each trial
     - /api/reconfirm  : re-judging a criterion after the patient adds info
     - the client      : recomputing a card's status when a "confirm" resolves

   So the rules text and the derivation live here, imported by all three, rather
   than being re-stated (and allowed to drift) in each place.
   ========================================================================== */

import type { Criterion, MatchStatus } from "@/lib/types";

/** The verdict rules — the exact meaning of each verdict. Shared by every
 *  prompt that judges a criterion so the meaning system never forks. */
export const VERDICT_RULES = `Verdict rules (this is the product's meaning system — be exact):
- meets  : an INCLUSION criterion the patient satisfies. Cite the evidence.
- clear  : an EXCLUSION criterion that is NOT triggered (good for the patient).
- confirm: the record genuinely lacks the data to judge this criterion. Say so — never guess it into a pass or a fail. This becomes a coordinator to-do (e.g. "confirm RECIST measurability", "confirm HbA1c").
- fails  : an INCLUSION criterion the patient does not meet, OR an EXCLUSION criterion that IS triggered.

Hard requirements:
- Fail closed. If the patient is a near-miss, list EVERY failing criterion, not just the first. A false "so close" is worse than a clean no.
- Cite the record in the coordinator's words in the evidence field. Be concrete.
- Do not invent patient data. If the profile is silent on something a criterion needs, that criterion is "confirm", not a pass.
- Keep requirements atomic and in plain clinical language.`;

/** A criterion counts toward "met" when an inclusion is satisfied or an
 *  exclusion is not triggered. */
export function metCountOf(criteria: Criterion[]): number {
  return criteria.filter((c) => c.verdict === "meets" || c.verdict === "clear").length;
}

/** Derive a trial's overall standing from its criteria — fail-closed and
 *  explainable, never a model's self-report. Any fail → ruled out (near);
 *  else any open confirm → uncertain; else eligible. No criteria → screened. */
export function deriveStatus(criteria: Criterion[]): MatchStatus {
  if (criteria.length === 0) return "screened";
  const hasFail = criteria.some((c) => c.verdict === "fails");
  const hasConfirm = criteria.some((c) => c.verdict === "confirm");
  return hasFail ? "near" : hasConfirm ? "uncertain" : "eligible";
}
