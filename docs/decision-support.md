# Decision support — design rationale

This note explains the decision-support layer added to Trial's results screen, and the
thinking behind it. It answers a piece of product feedback:

> "How do we make the decision-making process feel *satisfying*? This is a big decision for
> the people involved. How can we make risks and benefits feel clearer, and give the patient
> agency?"

## The problem

Before this change, Trial answered **eligibility** — *does this patient qualify?* — as a ranked
list of trials, each with a criterion ledger (meets / clear / confirm / fails). That's the
trust surface, and it's good at what it does. But it stopped there. A coordinator saw a list of
qualifying trials with no help *weighing* them, the patient wasn't in the loop, and a single
trial's reasoning was a long, flat wall of criteria — testers said they didn't know where to
look first.

Choosing a trial is one of the highest-stakes decisions a patient makes. Eligibility is the
floor, not the product. The decision-support layer sits on top of the eligibility engine and
helps a patient, with their care team, actually *weigh and choose*.

## What we added

**1. A patient-facing decision brief (per trial).**
For every trial the patient could join, three plain-language blocks:

- **Could offer** — what the trial is studying / could offer, framed as *potential*, phase-aware.
- **Asks of you** — the real commitment: randomization or placebo possibility, visits and
  procedures, travel to the nearest site, study length.
- **Still uncertain** — what's experimental or unknown, appropriate to the phase.

Plus **2–3 questions to bring to the care team**, drawn from the trial's open items (the
`confirm` criteria) and its uncertainties. This turns "insufficient info" from a dead end into
an action the patient owns.

**2. Preference controls — the agency lever.**
A row of toggles — *Stay near home · Established science · Avoid randomization/placebo · Lower
burden* — lets the patient/coordinator re-rank by what *they* value. The list reorders and each
card annotates *why* it moved ("moved up: open-label, no randomization"). Off by default. This
is agency made concrete: the ordering reflects the patient's priorities, not just a score.

**3. A "to discuss" shortlist.**
The patient stars trials to build their own takeaway — the artifact they walk into the
appointment with.

**4. Information hierarchy on each card.**
The card now leads with the brief (plain language — *look here first*), then an at-a-glance
factor row, then the questions. The **eligibility ledger is collapsed behind an accordion**
with a summary tally (`5 met · 4 to confirm · 2 not met`). Opened, it's **grouped by verdict**
(To confirm → Not met → Met) and **filterable** by tally chip — so the actionable calls surface
first instead of a flat list. Ruled-out trials open the ledger by default, because *why not* is
the point there.

## How risk/benefit stays honest

The brief is **grounded only in real trial attributes** pulled live from ClinicalTrials.gov —
phase, study type (interventional vs observational), randomization and masking, primary
purpose, interventions, and site locations — plus the eligibility findings. It never invents
efficacy or outcomes. It is explicitly **phase-honest**: a Phase 1 study is described as testing
safety and dosing with benefit unproven; an observational study as contributing data with no
treatment. The model is instructed, in the system prompt, never to promise benefit and never to
tell the patient what to choose.

## Trust guardrails (non-negotiable)

- **Non-directive.** Nothing is labelled "best" or "recommended." The tool frames the decision;
  the patient and care team make it. The summary and disclaimer say so plainly.
- **Ranking stays explainable.** Preference re-ranking runs over **deterministic factors computed
  in code** (phase rank, proximity, randomization, a rough burden proxy) — never a model's
  self-reported confidence. Every reorder shows its reason.
- **The eligibility ledger is preserved**, one click away on every card. The decision brief is
  supporting structure; the sourced criterion reasoning remains the signature and the evidence.
- **Overall status is still derived from the criteria, fail-closed.** A near-miss lists every
  failing criterion.
- **Disclaimer + agency framing** stay visible: *informational decision support for review with a
  care team — not medical advice, and it does not choose for you.*

## What's approximate / out of scope

- **Proximity** is an approximate city/state match against the patient's stated location, not a
  geocoded distance — and it's labelled as such in the UI.
- **Burden** is a rough estimate from study type and phase, surfaced honestly.
- Not addressed in this pass (separate feedback themes): a formal **eval harness**, **HIPAA /
  compliance** readiness, and deep **clinical-workflow** integration.
