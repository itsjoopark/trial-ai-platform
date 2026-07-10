# Trial

A coordinator-first clinical trial matcher — paste a patient's notes, surface the
recruiting trials they're eligible for, with the inclusion/exclusion reasoning
shown and sourced for every match. Built for the Cerebral Valley × Anthropic ×
Gladstone "Build Beyond the Bench" hackathon.

> Informational decision support for a coordinator's review — not medical advice
> or a final eligibility determination. Synthetic personas only; no real PHI.

## Frontend

The frontend base lives in [`web/`](web/) — plain HTML/CSS/JS, no build step and
no CDN dependency. Just open it:

```bash
open web/index.html          # macOS
# or serve it: python3 -m http.server -d web 8000  → http://localhost:8000
```

It walks the PRD v4 agentic flow end to end:

**landing → capture → clarify → confirm → reason → results**

Click **"Try a sample patient (Margaret)"** to run the whole flow. Light mode is
the default; a **Dark** toggle sits in the header.

### Structure

| File | Role |
|------|------|
| `web/index.html` | Skeleton; loads the stylesheet + app |
| `web/styles.css` | Design tokens (light default + dark) and all component styles |
| `web/app.js` | Phase state machine + **mock data** (clearly labelled `sample data` in the UI) |

### Wiring it to the real engine

`app.js` is a UI scaffold. The mock constants are the seams to replace with the
agentic Claude + ClinicalTrials.gov layer:

- `NOTE` / `FIELDS` → `POST /extract` (free-text note → structured profile)
- `CLARIFY` → `GET /clarify` (only the gaps that change a match)
- `FACETS` → agent-derived from the profile (PRD §6.5)
- `RESULTS` → `POST /rank` (retrieve → segment → per-criterion reason → actor-critic)

The design system (palette, type, the criterion-ledger component, trust
invariants) is documented in `.claude/skills/design-system/`.

## License

MIT — see [LICENSE](LICENSE).
