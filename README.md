# Trial

A coordinator-first clinical trial matcher — paste a patient's notes, surface the
**recruiting ClinicalTrials.gov trials** they're eligible for, with the inclusion/exclusion
reasoning shown and sourced for **every** match. Built for the Cerebral Valley × Anthropic ×
Gladstone "Build Beyond the Bench" hackathon.

> Informational decision support for a coordinator's review — not medical advice or a final
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

**landing → capture → clarify → confirm → reason → results**

## Architecture

| Path | Role |
|------|------|
| `app/page.tsx` | The coordinator console — a client-side phase state machine that calls the routes between phases |
| `app/globals.css` | Design tokens (light default + dark) and all component styles |
| `app/api/extract` | `POST` note → structured profile + clarifying gaps (Claude, structured output) |
| `app/api/trials` | `GET ?cond=` → normalized recruiting trials (ClinicalTrials.gov proxy) |
| `app/api/match` | `POST` profile → ranked trials with per-criterion ledgers (Claude, one call per trial) |
| `lib/ctgov.ts` | ClinicalTrials.gov v2 fetch + normalization |
| `lib/schemas.ts` | Zod schemas that constrain Claude's structured output |
| `lib/anthropic.ts` | Anthropic client + pinned model |

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
