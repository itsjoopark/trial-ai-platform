---
name: design-system
description: The Claude Science / Trial design system — the operating method, committed color/type/space tokens, the criterion-ledger signature component, and the trust invariants every Trial surface must honor. Load BEFORE building or restyling ANY interface, artifact, page, chart, or component in this repo, and before choosing any color, font, or layout.
---

# Claude Science design system (Trial)

Trial turns a coordinator's free-text patient notes into a ranked list of ClinicalTrials.gov trials the patient is eligible for — **with the inclusion/exclusion reasoning shown and sourced for every match**, so the coordinator verifies each call instead of trusting a black box. The design exists to make that reasoning *legible and checkable*. Everything below serves that job.

This system has two layers, matching the two names the team uses:

- **Claude Design → the method.** We build the way Anthropic's `frontend-design` skill prescribes: distinctive, subject-grounded, non-templated; spend boldness in one place; hold a real quality floor. That method is summarized in **§1** and is authoritative for *how* we make decisions.
- **Claude Science → the committed system.** The method has already been run for this product. The concrete result — tokens, components, invariants — is locked in **§2–§6** so every screen reads as one product. Within Trial, **consistency wins**: reach for these tokens and components rather than re-inventing. Apply the method fresh only for a genuinely new surface the system doesn't cover yet — and when you do, extend the system, don't fork it.

Tokens live in [`references/tokens.css`](references/tokens.css). Paste that `:root` block into any artifact (the CSP blocks external CSS), or import it in the product build. Every value below refers to those custom properties.

---

## 1. Method (inherited — "Claude Design")

Non-negotiable operating rules, condensed from `frontend-design`:

- **Ground every choice in the subject.** Our subject is clinical eligibility screening for a research coordinator. Distinctive choices come from that world — criteria prose, verdicts, cited evidence, live registry data — not from generic SaaS.
- **One signature, everything else quiet.** Our signature is the **Criterion Ledger** (§4). It is the one memorable element; the surrounding chrome stays disciplined and calm so the reasoning reads.
- **Structure must encode something true.** Use a device only when it carries real meaning. Numbered markers are allowed *only* for genuine sequences (the intake → review → results flow; ranked results). Don't number things that aren't ordered.
- **Type is personality, not a delivery vehicle** — see §3.
- **Motion is purposeful and brief.** Expand/collapse a ledger, transition intake→results. No ambient or decorative animation. Respect `prefers-reduced-motion`.
- **Avoid the AI-default looks.** Do not drift into warm-cream + serif-display + terracotta, near-black + acid-green pop, or hairline broadsheet columns. Our committed palette (§2) is deliberately none of these.
- **Self-critique before shipping.** Remove one accessory. If a screen reads like the generic answer for any dashboard, it's wrong — push it back toward the subject.

---

## 2. Color

A **cool, blue-biased neutral** ground under a single **deep petrol-blue brand**. The brand is the *only* saturated brand color on the page. Bold lives in one place.

Crucially, the brand is **blue** and the three **verdict** colors are green / amber / red — kept apart on purpose, because the verdict triad is the product's meaning system and must never be confused with brand decoration.

| Role | Token | Light | Use |
|---|---|---|---|
| Ground | `--paper` | `#f4f6f8` | page background |
| Surface | `--surface` | `#ffffff` | cards, panels |
| Inset | `--surface-2` | `#edf1f4` | table fills, wells |
| Text | `--ink` / `--ink-2` / `--ink-3` | `#14212b` … | primary / secondary / muted |
| **Brand** | `--brand` / `--brand-strong` | `#17506e` / `#1e6e8c` | identity, links, primary action |
| **Meets** | `--meets` / `--meets-bg` | `#1f8a54` / `#e3f2e9` | criterion satisfied |
| **Confirm** | `--confirm` / `--confirm-bg` | `#b27a12` / `#f7eed9` | insufficient info → coordinator to-do |
| **Fails** | `--fails` / `--fails-bg` | `#c33b30` / `#f9e5e2` | criterion not met |

Rules:
- **Never** style a verdict with the brand color, or the brand with a verdict color.
- **Never** add a fourth verdict hue. Every eligibility call is exactly Meets, Confirm, or Fails.
- Verdict `-bg` tints are for the small status chip/icon only — don't flood whole rows with them; keep the ledger calm and let the mark carry the state.
- Both themes are defined in `tokens.css`. The toggle stamps `data-theme` on `:root` and **must** override `prefers-color-scheme` in both directions.

---

## 3. Typography

Three roles. The **monospace is the signature utility face** — it carries all clinical data, which is the subject's raw material.

- **Sans** (`--font-sans`) — the UI: headings, labels, running text.
- **Mono** (`--font-mono`) — **all clinical data**: NCT IDs, biomarkers (`PIK3CA H1047R`), dates, ECOG, `incl`/`excl` tags, criteria tallies. Mono-for-data is how a Trial screen is recognizable at a glance. Don't set data in the sans; don't set prose in the mono.
- **Serif** (`--font-serif`) — optional editorial accent for long-form study summaries or a case masthead. Used with restraint, never for UI chrome.

Preferred faces (Söhne / Tiempos) assume the product self-hosts them; the fallback stacks in `tokens.css` carry the identity everywhere else, including Artifacts where webfont CDNs are blocked — **never link a webfont URL** (it fails silently under CSP).

Scale: use the `--text-*` steps, don't invent sizes. Large headings take `--tracking-tight` and `text-wrap: balance`; uppercase labels take `--tracking-label`. Keep running prose near 65 characters wide. Use `font-variant-numeric: tabular-nums` anywhere digits align in a column (tallies, criteria-met ratios, dates).

---

## 4. Signature component — the Criterion Ledger

The ledger is the product. Every match and every near-miss is a list of atomic criteria, each tracing one requirement to the specific evidence in the record and a verdict. This component gets the most care; everything else supports it.

**Anatomy of a ledger row:**

```
[verdict mark] [kind tag]  Requirement text            [verdict word]
               incl/excl   └ cited evidence from the record
```

- **verdict mark** — a small square icon in the verdict color: `✓` meets, `?` confirm, `✕` fails. Tinted with the matching `-bg`.
- **kind tag** — mono, uppercase: `incl` (neutral, `--surface-2`) or `excl` (filled `--brand`), so inclusion vs. exclusion is legible without reading.
- **requirement** — the atomic criterion, in sans.
- **evidence** — the "why", citing the record in the coordinator's words: `Palbociclib (1L) — progressed Dec 2025`. Bold the specific value that drove the call.
- **verdict word** — mono, right-aligned: `meets` / `clear` / `confirm` / `fails`.

**States** map 1:1 to the verdict triad — Meets (`--meets`), Confirm (`--confirm`), Fails (`--fails`). No other row state exists.

**Minimum markup** (style through tokens):

```html
<div class="crit meet">
  <span class="mark" aria-hidden="true">✓</span>
  <div class="req">
    <span class="kind i">incl</span>Progression on a prior CDK4/6 inhibitor
    <span class="ev"><b>Palbociclib</b> (1L) — progressed Dec 2025.</span>
  </div>
  <span class="verdict">meets</span>
</div>
```

**Actor–critic annotation.** Where a critic pass changed or held a call, surface it beside the ledger in a brand-keyed note ("actor asserted 7/7; critic held 2 at confirm"). This is the auditable trail — it is a feature, show it, don't hide it.

Supporting components reuse these primitives: **trial card / entry** (title, phase + NCT in mono, sponsor, criteria-met ratio, then the ledger), **case/patient header** (profile summary; mono for all clinical values), **status pill**, **source cite** (deep link to `clinicaltrials.gov/study/<NCT_ID>`, always `target="_blank" rel="noopener"`), and the **disclaimer** (§6).

---

## 5. Layout, space & motion

- **A tool is scanned, not read.** Surface the summary before the detail: counts (eligible / to-confirm / near-miss / screened) sit above the ranked list; each trial expands to its ledger.
- Lay siblings out with flex/grid + `gap` on the `--space-*` scale — not per-element margins. Wide content (tables, long criteria) gets its own `overflow-x: auto`; the page body never scrolls sideways.
- Default rounding is `--radius` (10px). Don't round everything to `--radius-lg`; reserve that for large cards.
- Elevation is restrained — borders (`--line`) do most of the work in light mode; `--shadow` only lifts the primary card.
- Motion: `--dur` / `--ease` for expand/collapse and the intake→results transition. Nothing ambient. `prefers-reduced-motion` is honored in `tokens.css`.

---

## 6. Product invariants (trust — never violate)

These come straight from the PRD and outrank aesthetics. A beautiful screen that breaks one of these is wrong.

1. **Show the reasoning for every match.** No bare score, no black box. Every eligible trial exposes its per-criterion ledger.
2. **"Confirm" (uncertain) is a first-class verdict.** When the record lacks the data to judge a criterion, say so — never guess it into a pass or a fail. It becomes a coordinator to-do ("confirm RECIST measurability"), not a silent match.
3. **Near-misses fail closed — list *every* failing criterion, not just the first.** A false "so close" is worse than a clean no.
4. **Cite the source.** Every trial shows phase, sponsor, NCT ID, **all** current locations pulled live, and a deep link to ClinicalTrials.gov. Freshness and completeness are our differentiator — don't truncate locations.
5. **Rank on explainable signal** (criteria-met ratio, phase, proximity) — never on a model's self-reported confidence.
6. **Always surface the disclaimer:** *"Informational decision support for a coordinator's review — not medical advice or a final eligibility determination."* And in any demo/prototype: synthetic personas only, no real PHI.

---

## 7. Writing & voice

Copy is design material (per §1). For this product:

- **Consistent verbs, everywhere:** a criterion **Meets** / needs **Confirm** / **Fails**; an exclusion is **Clear** when not triggered. The word in the ledger, the pill, and the summary is the same word.
- **Coordinator's vocabulary, not the system's.** "Why she matches", "What rules her out", "3 criteria to confirm" — not "criterion evaluation results."
- **Honesty is the brand.** Prefer "insufficient info to judge — confirm HbA1c" over false precision. The tool's credibility is the product.
- Active voice; sentence case; specific over clever. Errors and empty states explain what happened and the next action, in the interface's voice.

---

## 8. Quality floor

Responsive to mobile; visible keyboard focus (`:focus-visible`, offset ring in `--brand`); both themes given equal care; reduced motion respected; semantic HTML; `aria-expanded` on ledger toggles. Watch CSS specificity — don't let type-based selectors cancel element-based ones over spacing. Verify contrast of verdict colors on both grounds. Take a screenshot and critique before calling a screen done.
