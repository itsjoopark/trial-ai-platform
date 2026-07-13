"use client";

import { useEffect, useRef, type RefObject } from "react";

const CELL = 11;
const FONT = '10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const GLYPHS = ["·", "·", "×", "+", "A", "T", "C", "G", "0", "1", "N", "○"] as const;
const BASES = ["A", "T", "C", "G"] as const;

type Mouse = { x: number; y: number };

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function palette(): { accent: string } {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  // Trial accent (design.md §3): --blue #3D6BB3 light · #7CA0DB dark
  return { accent: dark ? "124, 160, 219" : "61, 107, 179" };
}

/** Organic contours + clinical motifs (cell rings, helix, EKG, scale ticks). */
function field(x: number, y: number, w: number, h: number, t: number): number {
  const nx = x / w;
  const ny = y / h;
  const span = Math.min(w, h);

  const drift = Math.sin(nx * 7.5 + t * 0.00035) * Math.cos(ny * 5.5 - t * 0.00028) * 0.22;

  const bx = w * 0.64;
  const by = h * 0.4;
  const d = Math.hypot(x - bx, y - by);
  const cellRing = Math.exp(-d / (span * 0.34)) * Math.sin(d * 0.042 - t * 0.0007) * 0.5;

  const bx2 = w * 0.52;
  const by2 = h * 0.47;
  const d2 = Math.hypot(x - bx2, y - by2);
  const careBlob = Math.exp(-d2 / (span * 0.24)) * 0.32;

  const helixX = w * 0.8;
  const helix = Math.exp(-((x - helixX) ** 2) / ((w * 0.035) ** 2)) * Math.sin(y * 0.052 + t * 0.0009) * 0.28;

  const ekgY = h * 0.74;
  const ekg = Math.exp(-((y - ekgY) ** 2) / 820) * Math.abs(Math.sin(x * 0.028 + t * 0.0018)) * 0.22;

  const ruler = x < w * 0.07 && Math.abs(Math.sin(y * 0.11)) > 0.9 ? 0.18 : 0;

  let v = drift + cellRing + careBlob + helix + ekg + ruler;

  const colL = w * 0.5 - 400;
  const colR = w * 0.5 + 400;
  if (x > colL && x < colR && y < h * 0.88) v *= 0.38;

  return v;
}

function glyph(v: number, xi: number, yi: number): string {
  if (v < 0.07) return "·";
  if (v > 0.36 && (xi + yi) % 6 === 0) return BASES[xi % 4];
  if (v > 0.3 && (xi + yi) % 8 === 0) return "N";
  const i = Math.abs(Math.floor(v * 19 + xi * 5 + yi * 11)) % GLYPHS.length;
  return GLYPHS[i];
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  mouse: Mouse | null,
  t: number,
  staticField: boolean,
) {
  ctx.clearRect(0, 0, w, h);
  const { accent } = palette();
  const time = staticField ? 0 : t;

  ctx.font = FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const cols = Math.ceil(w / CELL);
  const rows = Math.ceil(h / CELL);

  for (let yi = 0; yi < rows; yi++) {
    for (let xi = 0; xi < cols; xi++) {
      const x = xi * CELL + CELL / 2;
      const y = yi * CELL + CELL / 2;

      let v = field(x, y, w, h, time);

      let boost = 0;
      if (mouse) {
        const md = Math.hypot(x - mouse.x, y - mouse.y);
        if (md < 130) boost = (1 - md / 130) * 0.4;
      }
      v += boost;
      if (v < 0.055) continue;

      const alpha = Math.min(0.2, 0.035 + v * 0.18 + boost * 0.08);

      if (v > 0.48 && (xi + yi) % 10 === 0) {
        ctx.fillStyle = `rgba(${accent}, ${Math.min(0.28, alpha * 1.35)})`;
        ctx.fillRect(x - 2, y - 2, 4, 4);
        continue;
      }

      let ox = 0;
      let oy = 0;
      if (mouse && boost > 0) {
        const ang = Math.atan2(y - mouse.y, x - mouse.x);
        const push = boost * 7;
        ox = Math.cos(ang) * push;
        oy = Math.sin(ang) * push;
      }

      ctx.fillStyle = `rgba(${accent}, ${alpha})`;
      ctx.fillText(glyph(v, xi, yi), x + ox, y + oy);
    }
  }
}

export default function AsciiBackground({ trackRef }: { trackRef: RefObject<HTMLElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef<Mouse | null>(null);
  const rafRef = useRef<number>(0);
  const tRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    const track = trackRef.current;
    if (!canvas || !host || !track) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = prefersReducedMotion();
    let w = 0;
    let h = 0;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawFrame(ctx, w, h, mouseRef.current, tRef.current, reduced);
    };

    const onMove = (e: MouseEvent) => {
      const rect = host.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (reduced) drawFrame(ctx, w, h, mouseRef.current, 0, true);
    };

    const onLeave = () => {
      mouseRef.current = null;
      if (reduced) drawFrame(ctx, w, h, null, 0, true);
    };

    const tick = (now: number) => {
      tRef.current = now;
      drawFrame(ctx, w, h, mouseRef.current, now, false);
      rafRef.current = requestAnimationFrame(tick);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    track.addEventListener("mousemove", onMove);
    track.addEventListener("mouseleave", onLeave);

    const themeObs = new MutationObserver(() => drawFrame(ctx, w, h, mouseRef.current, tRef.current, reduced));
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    if (!reduced) rafRef.current = requestAnimationFrame(tick);

    return () => {
      ro.disconnect();
      themeObs.disconnect();
      track.removeEventListener("mousemove", onMove);
      track.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(rafRef.current);
    };
  }, [trackRef]);

  return (
    <div ref={hostRef} className="ascii-bg" aria-hidden>
      <canvas ref={canvasRef} />
    </div>
  );
}
