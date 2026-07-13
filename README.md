# Trial

A patient- and caregiver-facing clinical trial matcher with **coordinator-grade output** — describe
your situation, upload a note, or connect your records, and Trial surfaces the **recruiting
ClinicalTrials.gov trials** you may be eligible for, with the inclusion/exclusion reasoning shown and
sourced for **every** match. The intake speaks to you in plain language; the output is rigorous and
clinical, framed as *"what to bring to your care team."* Built for the Cerebral Valley × Anthropic ×
Gladstone "Build Beyond the Bench" hackathon.

> Informational support for a conversation with your care team — not medical advice or a final
> eligibility determination. Trial data is pulled live from ClinicalTrials.gov. Use synthetic
> personas only; no real PHI.

## Stack

- **Next.js 16 (App Router) + React 19 + TypeScript** — one app, deploys to Vercel with zero config.
- **ClinicalTrials.gov API v2** — live recruiting-trial data (no API key needed). Proxied
  server-side because the registry doesn't send CORS headers.
- **Anthropic API (Claude Opus 4.8)** — reads the note into a structured profile and reasons
  each trial's eligibility criteria into a per-criterion verdict ledger.

The agent/registry work runs entirely in **server route handlers**, so the Anthropic key never
reaches the browser.

## Run it locally

```bash
npm install
cp .env.example .env.local     # then paste your ANTHROPIC_API_KEY into .env.local
npm run dev                    # http://localhost:3000
```

Get an Anthropic key at <https://console.anthropic.com>. ClinicalTrials.gov needs no key.

Click **"Try a sample patient (Margaret)"** to run the whole flow. Light mode is the default; a
**Dark** toggle sits in the header.

The flow, end to end:

**landing → capture → clarify → confirm → reason → results → the Fork**

### The Fork — which doors a next treatment closes

After Results, the **Fork** is the differentiator: a next line of treatment can quietly *close* the
door on a trial (a "no prior AKT inhibitor" exclusion, a "≤2 prior lines" cap). The patient picks
what their care team is weighing — the plausible next lines are **generated from their note**, not
typed in — or "Nothing decided yet" to see the whole decision tree. For each currently-open trial,
we **reuse its existing criterion ledger** (no re-reasoning) to judge **stays open / closes /
confirm**, always citing the driving criterion. Fail-closed like `/api/match`; every closing-door
view carries the required framing that this is *not* a reason to change a treatment plan. It reuses
the deterministic `enrollmentWindow` + proximity factors for the time-sensitivity line.

## Architecture

| Path | Role |
|------|------|
| `app/page.tsx` | The patient console — a client-side phase state machine that calls the routes between phases |
| `app/globals.css` | Design tokens (light default + dark) and all component styles |
| `app/api/extract` | `POST` note (or FHIR document) → structured profile + clarifying gaps, each field mCODE-mapped and provenance-tagged (Claude, structured output) |
| `app/api/upload-pdf` | `POST` PDF → extracted text for the same extract flow |
| `app/api/connect-records` | `GET` picker · `POST` pull one patient's chart via SMART on FHIR → provenance-delimited document |
| `app/api/trials` | `GET ?cond=` → normalized recruiting trials (ClinicalTrials.gov proxy) |
| `app/api/match` | `POST` profile → ranked trials with per-criterion ledgers (Claude, one call per trial) |
| `app/api/reconfirm` | `POST` re-judge open "confirm" criteria after the patient adds info (shared verdict rules) |
| `app/api/fork-options` | `POST` profile → plausible next treatment lines (Claude) + two fixed options in code |
| `app/api/fork` | `POST` a next treatment × open trials → stays-open / closes per trial, citing the criterion |
| `lib/fhir/client.ts` | SMART on FHIR R4 sandbox client — minimized resource pull, `DocumentReference`→`Binary`, compose |
| `lib/fhir/testPatients.ts` | Bundled mCODE R4 oncology test patients (carry the notes the open sandbox lacks) |
| `lib/ctgov.ts` | ClinicalTrials.gov v2 fetch + normalization |
| `lib/schemas.ts` | Zod schemas that constrain Claude's structured output |
| `lib/anthropic.ts` | Anthropic client + pinned model |

### Getting records in (three entry paths)

A patient enters through any of three doors on Capture, all funneling into the same extractor:

1. **Paste / describe** — free text or a pasted note.
2. **Upload a PDF** — a visit summary or pathology report (`/api/upload-pdf`).
3. **Connect my medical records** — a real **SMART on FHIR R4** pull. Under the Cures Act
   (g)(10), the patient authorizes an app to pull their own chart; we retrieve only the resources
   we match on (data minimization), flatten structured resources **and** `DocumentReference` note
   narratives into one document, and read it with Claude. The demo runs against the public
   [SMART Health IT sandbox](https://launch.smarthealthit.org) (synthetic patients, no auth, zero
   real PHI) plus bundled mCODE oncology test patients.

A **scope chip row** on the entry screen (study-type: treatment · tests · observational · expanded
access, plus travel band + ZIP) narrows the candidate set **before** the reasoning pass — the
study-type selection is applied server-side at ClinicalTrials.gov (`AREA[StudyType]` /
`AREA[DesignPrimaryPurpose]` on `filter.advanced`), so excluded studies never consume a Claude call.
It's collapsed by default with sensible defaults, adds zero steps, and travel only *ranks* (never
hard-filters). Study type is scope; it is not eligibility.

Every profile field is **mCODE / USCDI+ CTM mapped** (the federal cancer-trial-matching schema)
and carries a **provenance badge** — `FHIR` (structured chart data), `note` (read from a
narrative), or `you` (you told us / edited). The moat: FHIR reliably carries demographics,
conditions, receptors, meds; the decisive oncology variables (biomarkers, RECIST, washout dates,
line-of-therapy) live in the notes, and Claude is what turns those into a matchable profile.

### How matching works

`/api/match` fetches a pool of recruiting trials for the patient's condition, then runs full
per-criterion Claude reasoning over the **top 10** (bounded concurrency, one call per trial).
Each trial's eligibility prose is segmented into atomic criteria and each is judged
**meets / clear / confirm / fails** against the profile. Trust invariants are enforced in code,
not left to the model:

- **Overall status is derived from the criteria (fail-closed)** and ranked on the criteria-met
  ratio — never on a model's self-reported confidence.
- **"confirm" (insufficient info) is first-class** — a coordinator to-do, never guessed into a
  pass or a fail.
- Trials beyond the top 10 are shown as **"screened — not yet reasoned"**, never silently dropped.

The tuning knobs (`CANDIDATE_POOL`, `DEEP_REASON_COUNT`, `CONCURRENCY`) are named constants at
the top of `app/api/match/route.ts`.

## Deploy to Vercel

1. Push to GitHub.
2. Import the repo in Vercel — it auto-detects Next.js at the root; no build config needed.
3. **Project → Settings → Environment Variables**: add `ANTHROPIC_API_KEY`.
4. Deploy. (ClinicalTrials.gov needs no key.)

The design system (palette, type, the criterion-ledger component, trust invariants) is documented
in `.claude/skills/design-system/`.

## License

MIT — see [LICENSE](LICENSE).
