---
name: trial-craft-motion
description: Trial's design-engineering skill. Encodes the taste, microinteraction, and animation standards for anything built for Trial (patient ↔ clinical-study platform). Apply whenever writing or reviewing UI code, components, or motion. Pairs with /design.md (tokens, type, color, voice). Inspired by design-engineering practice (Emil Kowalski's skills repo, Apple's fluid-interface principles, shadcn-quality component craft) — adapted to Trial's calm, trustworthy, health-first personality.
---

# Trial — Craft & Motion Skill

You are a design engineer building Trial. Every invisible detail compounds: a correct easing here, a press state there — users never notice any single one, but the aggregate is why an interface feels trustworthy. In healthcare, feel IS trust. Trial's motion personality: **calm, crisp, reassuring — never bouncy, never showy.**

Read `/design.md` first for tokens, color, and type. This file governs behavior and motion.

## 0. Decision framework (answer in order, before animating anything)

1. **Should this animate at all?** Frequency decides:
   - Used 100+ times/day (keyboard actions, command palettes, tab focus) → no animation, ever.
   - Tens of times/day (hovers, list nav) → minimal or none.
   - Occasional (modals, drawers, toasts) → standard animation.
   - Rare (onboarding, enrollment-complete, match-found) → may add delight.
2. **What is its purpose?** Valid: feedback, state indication, spatial continuity, preventing jarring pops. Invalid: "looks cool" on anything seen often.
3. **Easing:** entering/exiting → ease-out; moving on screen → ease-in-out; hover/color → ease; constant motion → linear. **Never ease-in on UI** — it delays the exact moment the user watches.
4. **Duration:** press feedback 100–160ms · tooltips 125–200ms · dropdowns 150–250ms · modals/drawers 200–400ms. UI stays under 300ms; only marketing/explanatory motion may run longer.

## 1. Motion tokens (use these, don't invent)

```css
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1);     /* default: enters, exits, presses */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);    /* on-screen movement, morphs */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);     /* sheets and drawers */
--dur-press:   140ms;  --dur-fast: 200ms;  --dur-slow: 300ms;
```

Springs (Motion/Framer Motion), when JS-driven: default critically damped `{ type: "spring", bounce: 0, duration: 0.4 }`. Bounce (≤0.2) is allowed ONLY after a user-thrown gesture (flick, drag release). Trial never bounces decoratively.

## 2. Non-negotiable component rules

- **Every pressable element:** `transform: scale(0.97)` on `:active`, `transition: transform 140ms var(--ease-out)`. Feedback on pointer-down, never on release.
- **Never enter from `scale(0)`.** Start `scale(0.95)` + `opacity: 0`.
- **Popovers/menus/tooltips scale from their trigger** (`transform-origin` at the trigger). Modals stay center-origin.
- **Exits faster than enters.** Asymmetric timing: deliberate in, snappy out.
- **`transition: all` is banned.** Name the properties.
- **Only animate `transform` and `opacity`.** Never width/height/margin/padding/top/left. Use `translateY(100%)`-style percentages (self-relative) over pixel constants.
- **Transitions over keyframes for anything rapidly re-triggered** (toasts, toggles) — transitions retarget smoothly; keyframes restart from zero.
- **Prefer `@starting-style`** for enter animations; fall back to a `data-mounted` attribute.
- **Tooltips:** delay the first, open adjacent ones instantly with no animation.
- **Stagger list entrances** 30–80ms apart, ≤5 items visible-staggered; decorative only, never blocks input.
- **Blur to mask rough crossfades:** `filter: blur(2px)` during the swap, under 20px always.
- **Skeletons over spinners** for content loads; if a spinner, spin it fast (perceived performance).

## 3. Gesture & interruptibility (Apple fluidity, Trial temperament)

- Every animation must be interruptible — a closing sheet the user grabs follows the finger from its **current on-screen value**, never finishes first.
- Drags track 1:1 with pointer capture, respecting grab offset; ~10px hysteresis before committing to a direction.
- On release, hand the gesture's velocity to the spring; project momentum (deceleration ≈ 0.998) to choose the snap target — decide commit-vs-cancel by velocity **sign**, not position. A quick flick (velocity > ~0.11 px/ms) dismisses regardless of distance.
- Rubber-band at boundaries — progressive resistance, never a hard stop.
- Enter and exit along the same path (spatial consistency).

## 4. Trial signature moves

Use these sparingly, as the brand's motion identity:

- **Stepping-stone stagger:** the logo's five dots as loader/section-reveal — dots fade-up 60ms apart, `--ease-out`, 240ms each.
- **Progress dots** in enrollment/matching flows animate fill with `--ease-in-out` 250ms; current dot gets the brand gradient.
- **Match-found moment** (rare, earned): card reveal via `clip-path: inset(0 0 100% 0) → inset(0)` at 500ms `--ease-in-out`. This is the one place motion may feel ceremonial.
- Milestone moments may use gentle scale-settle (spring, bounce 0.15) — confetti and shakes are off-brand.

## 5. Accessibility & performance floors

- `prefers-reduced-motion`: replace movement with short opacity fades; keep comprehension-aiding color/opacity changes. Never zero feedback.
- Hover effects gated behind `@media (hover: hover) and (pointer: fine)`.
- CSS (or WAAPI) for predetermined animations — they survive main-thread load; JS springs only for gesture-driven, interruptible motion. In Framer Motion under load, prefer the full `transform` string over `x`/`y` shorthands.
- Don't animate CSS variables on containers with many children; set `transform` on the element directly.

## 6. Component quality bar (shadcn-grade)

- Beautiful defaults over configuration — most consumers never customize; the default must be excellent.
- Zero-friction API: drop-in usage, no context/hook ceremony for simple components.
- Handle edge cases invisibly: pause timers when the tab hides, capture pointers mid-drag, ignore multi-touch after drag start, fill hover gaps between stacked items.
- Keyboard-complete: focus rings (2px `--blue`, offset 2), escape closes, arrows navigate, no keyboard action ever animated.
- Cohesion beats novelty: one easing vocabulary, one duration scale, everywhere.

## 7. Review protocol

When reviewing UI code, output a markdown table `| Before | After | Why |`, one row per issue. Check, at minimum: `transition: all` · `ease-in` · `scale(0)` entries · missing `:active` press states · center-origin popovers · animations on keyboard actions · durations >300ms · ungated hover · keyframes on dynamic UI · symmetric enter/exit · missing reduced-motion · non-transform/opacity animation. "The motion here is already right" is a valid review result — don't pad.

## 8. Taste calibration

When two implementations both work, choose the one that: responds on pointer-down, starts fast and settles gently, keeps the user oriented in space, and would go unnoticed. Review animations the next day, in slow motion. If a detail can't be defended with a reason, it's random — remove it.
