# Trial — Design System

Trial bridges patients to the clinical studies they need. The design language should feel the way the product should feel: calm, trustworthy, quietly premium. Inspired by modern consumer-health brands (Oura): editorial typography, warm neutral canvases, generous whitespace, one confident accent story — never "hospital software."

---

## 1. Brand essence

- **Calm authority.** Clinical credibility without coldness. No alarm colors, no dense dashboards on marketing surfaces.
- **Human first.** The patient is the protagonist. Photography and copy center people, not labs.
- **The crossing.** The logo's stepping stones (patient → study) are the core metaphor: progress, guidance, connection. Echo it in motion, section dividers, and step-based UI.

## 2. Logo

Source of truth: `uploads/trial-logo.svg` — five white stepping stones on a rounded-square gradient tile.

- **App icon / small (≤48px):** the gradient tile version, as-is.
- **In-page mark:** stones-only version recolored in Ink or the brand gradient on light canvases.
- **Lockup:** mark + "Trial" wordmark set in the display sans, weight 600, letter-spacing −0.01em, gap ≈ 0.4× mark height.
- **Clear space:** ≥ 25% of tile width on all sides. Never stretch, rotate, add shadows, or place the tile on busy photography without a subtle scrim.

## 3. Color

The palette is warm-neutral canvas + the logo's teal→blue gradient as the single accent story.

### Canvas (light, default)
| Token | Value | Use |
|---|---|---|
| `--canvas` | `#F7F5F2` | Page background (warm off-white) |
| `--surface` | `#FFFFFF` | Cards, panels |
| `--surface-sunken` | `#EFECE7` | Wells, input backgrounds |
| `--border` | `#E4E1DC` | Hairlines, card borders |

### Ink
| Token | Value | Use |
|---|---|---|
| `--ink` | `#1C1B1A` | Headlines, primary text |
| `--ink-secondary` | `#57544F` | Body text |
| `--ink-tertiary` | `#8A867F` | Captions, labels, metadata |

### Accent (from the logo)
| Token | Value | Use |
|---|---|---|
| `--teal` | `#3BA394` | Accent start; success-ish states |
| `--mid` | `#3C87A4` | Gradient midpoint |
| `--blue` | `#3D6BB3` | Accent end; links, focus rings |
| `--gradient` | `linear-gradient(135deg, #3BA394 0%, #3C87A4 54%, #3D6BB3 100%)` | Primary CTAs, hero moments, icon tile |
| `--teal-tint` | `#E7F2F0` | Accent-tinted chips/backgrounds |
| `--blue-tint` | `#E9EFF7` | Info-tinted backgrounds |

### Dark (immersive sections, app-night surfaces)
| Token | Value | Use |
|---|---|---|
| `--night` | `#141A1E` | Dark section background (cool near-black) |
| `--night-surface` | `#1E262C` | Cards on dark |
| `--night-ink` | `#F2F1EF` | Text on dark |
| `--night-ink-2` | `#9BA4A9` | Secondary text on dark |

**Rules**
- One gradient moment per screen (a CTA *or* a hero tile *or* a chart highlight) — never several.
- No pure `#FFF` page backgrounds; the canvas is always warm.
- Red is reserved for destructive/error only (`#B4483E`); never decorative.

## 4. Typography

Two families, one job each:

- **Display / UI sans — "Manrope"** (Google Fonts). Weights 400 / 500 / 600 / 700. All UI, labels, body, buttons.
- **Editorial serif — "Newsreader"** (Google Fonts), *italic*. Used sparingly for emphasis inside headlines — the "human" word or phrase — Oura-style: `Get the care <em>you deserve</em>`. Never for body text or UI.

### Scale (desktop)
| Role | Size / line | Weight | Notes |
|---|---|---|---|
| Hero | 64/1.05 | 600 | −0.02em tracking; serif-italic emphasis allowed |
| H1 | 44/1.1 | 600 | −0.02em |
| H2 | 32/1.15 | 600 | −0.01em |
| H3 | 22/1.3 | 600 | |
| Eyebrow | 13/1.2 | 700 | UPPERCASE, +0.08em tracking, `--ink-tertiary` |
| Body | 17/1.6 | 400 | `--ink-secondary` |
| Small | 14/1.5 | 500 | Captions, metadata |
| Button | 16/1 | 600 | |

Mobile: Hero 40, H1 32, H2 26; everything else unchanged. `text-wrap: balance` on headlines, `pretty` on body.

## 5. Spacing, radius, elevation

- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128. Marketing sections breathe: ≥96px vertical padding.
- **Radius:** 8 (inputs, chips) · 12 (buttons) · 16 (cards) · 24 (feature tiles, modals) · 999 (pills). The logo tile's 24% corner radius is the reference curve.
- **Elevation:** prefer borders over shadows. When needed: `0 1px 2px rgba(28,27,26,.05)` (resting) · `0 8px 24px rgba(28,27,26,.08)` (floating). Never harsh drop shadows.

## 6. Components

- **Primary button:** `--gradient` background, white text, radius 12, 14px×24px padding. Hover: brightness 1.05 + translateY(−1px). One per view.
- **Secondary button:** transparent, 1px `--ink` border, ink text. On dark: `--night-ink` border/text.
- **Tertiary/link:** `--blue` text, no underline; underline on hover.
- **Cards:** `--surface`, 1px `--border`, radius 16, padding 24–32. Eyebrow → H3 → body → link, in that rhythm.
- **Inputs:** `--surface-sunken` fill, no border at rest; 2px `--blue` focus ring. 48px min height.
- **Chips/status:** pill, `--teal-tint` bg + `--teal` text (positive), `--blue-tint` + `--blue` (info), sunken + tertiary ink (neutral).
- **Steps/progress:** dots echoing the logo stones — filled gradient dot for current, ink-20% for upcoming. Use for trial-matching and enrollment flows.

## 7. Imagery

- Warm, natural-light photography of real people in daily life — never stock "doctor with clipboard," never sterile labs.
- Duotone or subtle warm grade to sit on the canvas; imagery may bleed full-width in heroes.
- Product UI shown in device-free floating cards with radius 24 and soft elevation.
- Placeholders in mockups: subtly-striped blocks with a monospace note (e.g. `patient portrait — warm light`). Do not hand-draw illustrative SVG.

## 8. Motion & microinteractions

Full spec: **`.agents/skills/trial-craft-motion/SKILL.md`** — the design-engineering skill agents must load before writing or reviewing any Trial UI code. It encodes the animation decision framework (frequency → purpose → easing → duration), motion tokens, gesture physics, and the review protocol.

Headlines (details in the skill):

- **Tokens:** `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` for enters/exits/presses · `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` for on-screen movement · durations 140/200/300ms. UI motion never exceeds 300ms; never `ease-in`; never `transition: all`.
- **Feel:** every pressable scales to 0.97 on `:active`; nothing enters from `scale(0)`; popovers originate from their trigger; exits are faster than enters; keyboard actions never animate.
- **Physics:** gesture-driven UI is interruptible, tracks 1:1, hands off velocity to critically-damped springs (`bounce: 0` default — Trial never bounces decoratively).
- **Signature move:** staggered fade-up of the logo's stepping-stone dots (60ms stagger) for loaders, progress, and section reveals.
- **Floors:** `prefers-reduced-motion` swaps movement for fades; only `transform`/`opacity` animate; hover gated behind `@media (hover: hover)`.

## 9. Voice

- Second person, plain language, 8th-grade reading level for patient-facing copy.
- Reassure, don't hype: "We'll walk you through it" over "Revolutionizing clinical trials!"
- Clinical terms always paired with a plain-language gloss.
- No exclamation marks in UI. No emoji.

## 10. Accessibility

- Text contrast ≥ 4.5:1 (body) / 3:1 (large). `--ink-secondary` on `--canvas` passes; never set body copy in `--ink-tertiary` below 14px.
- Gradient buttons: white text passes on all stops.
- Hit targets ≥ 44px. Visible focus rings (2px `--blue`, 2px offset) on everything interactive.
