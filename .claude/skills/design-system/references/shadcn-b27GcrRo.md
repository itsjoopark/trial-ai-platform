# shadcn UI reference — preset `b27GcrRo` (style: `base-rhea`)

A **design reference**, not an installed dependency. We deliberately did **not** run
`shadcn init` here — it requires Tailwind and would overwrite `app/globals.css`,
replacing Trial's hand-built token system. Instead this file captures the preset's
design language so we can draw from it while keeping our own semantic-CSS + custom
property architecture (see [`tokens.css`](./tokens.css)).

Source: <https://ui.shadcn.com/create?preset=b27GcrRo> · `shadcn@latest init --preset b27GcrRo --template next`
Extracted by scaffolding the preset in an isolated throwaway dir and reading its output.

---

## What the preset is

- **Style `base-rhea`** — shadcn's Base-UI variant. Signature look: **rounder corners**
  (buttons are `rounded-2xl`), soft translucent focus rings, flat fills.
- **Base color `neutral`** — a pure grayscale palette in `oklch(L 0 0)` (zero chroma),
  plus one red `--destructive`. Dark mode adds a periwinkle `--sidebar-primary`.
- **Fonts** — `Inter` (`--font-sans`), `Geist Mono` (`--font-mono`).
- **Icons** — `lucide`. **Primitives** — `@base-ui/react`. **cva** for variants.

## Radius scale (base `--radius: 0.625rem` = 10px)

| Token | Formula | px |
|-------|---------|----|
| sm  | `--radius * 0.6` | 6 |
| md  | `--radius * 0.8` | 8 |
| lg  | `--radius`       | 10 |
| xl  | `--radius * 1.4` | 14 |
| 2xl | `--radius * 1.8` | 18 |
| 3xl | `--radius * 2.2` | 22 |

Buttons ship at `rounded-2xl` (~18px) — the rounded feel is the whole personality of `base-rhea`.

## Button conventions (from `components/ui/button.tsx`)

- **Base:** `rounded-2xl border border-transparent bg-clip-padding text-sm font-medium transition-all`
- **Focus:** `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30`
  → a **3px ring at ~30% opacity + a border-color shift** (soft, not a hard outline).
- **Press:** `active:translate-y-px` — a 1px downward nudge (their press idiom).
- **Disabled:** `opacity-50 pointer-events-none`.
- **Invalid:** `aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20`.
- **Sizes:** default `h-8 px-3` (32px), sm `h-7`, lg `h-9`, xs `h-6`; icon buttons are square (`size-8`).
- **Variants:** `default` (solid primary, `hover:bg-primary/80`), `outline`, `secondary`,
  `ghost`, `destructive` (tinted `bg-destructive/10`), `link`.

## Full color tokens (oklch) — for reference only, NOT adopted

```
:root  --background 1 0 0 · --foreground .145 0 0 · --primary .205 0 0
       --secondary/muted/accent .97 0 0 · --border/input .922 0 0 · --ring .708 0 0
       --destructive .577 .245 27.325 · --radius .625rem
.dark  --background .145 0 0 · --foreground .985 0 0 · --primary .922 0 0
       --sidebar-primary .488 .243 264.376 (periwinkle) · --destructive .704 .191 22.216
```

---

## What we adopted vs. deliberately did not

| Aspect | Decision | Why |
|--------|----------|-----|
| **Radius / rounder corners** | ✅ Adopted into `globals.css` | Signature of `base-rhea`; identity-neutral. Cards → 14px, small controls → 10px, `--radius`/`--r-lg` scale added. |
| **Neutral grayscale palette** | ❌ Kept ours | Trial's periwinkle-agent + green/amber/red verdict triad **is** the identity; grayscale would erase it. |
| **Soft focus ring (3px translucent)** | ➖ Already present | Our `.paste`/`.cbox` `:focus-within` already use `box-shadow 0 0 0 3px var(--agent-soft)` — same idiom. |
| **Press feedback** | ➖ Kept `scale(.97)` | We use the Emil Kowalski scale-on-press; `base-rhea`'s `translate-y-px` is the alternative idiom. |
| **Inter / Geist Mono fonts** | ❌ Kept `system-ui` | Apple typography guidance: prefer the platform font unless there's a reason; avoids loading a web font. |
| **Tailwind + cva + Base-UI** | ❌ Not installed | Would overwrite the hand-built CSS architecture; this repo is intentionally utility-class-free. |

To pull an actual component's markup later, scaffold the preset in a throwaway dir and copy
the JSX/classes as reference — do not `init` into this repo.
