"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

const DESKTOP_PER_VIEW = 3;

const SLIDES = [
  {
    title: "Live recruiting data",
    body: "Trial queries ClinicalTrials.gov in real time — no static trial lists that go stale.",
    detail: "Every screen pulls the current recruiting pool for the patient's condition.",
  },
  {
    title: "Per-criterion reasoning",
    body: "Each criterion is judged against the profile — meets, fails, or needs confirmation.",
    detail: "Near-misses list every failing criterion; uncertain calls are never guessed.",
  },
  {
    title: "Structured patient profiles",
    body: "Messy notes become structured records — biomarkers, staging, therapies, and location.",
    detail: "Clinical data renders in monospace; matching gaps are surfaced honestly.",
  },
  {
    title: "Questions that matter",
    body: "Trial asks only clarifications whose answer changes which trials qualify.",
    detail: "Clinical research coordinators (CRCs) confirm the profile before screening begins.",
  },
  {
    title: "Ranked, explainable results",
    body: "Eligible and uncertain trials are ranked with a sourced ledger for every match.",
    detail: "Phase, sponsor, locations, and NCT ID included for each study.",
  },
  {
    title: "Privacy by design",
    body: "HIPAA-aligned safeguards — encryption, role-based access, and audit logging.",
    detail: "Synthetic personas in demos; BAA required for production PHI.",
  },
] as const;

function chunkSlides<T>(slides: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < slides.length; i += size) {
    pages.push(slides.slice(i, i + size));
  }
  return pages;
}

export default function ProductCarousel() {
  const [perView, setPerView] = useState(DESKTOP_PER_VIEW);
  const total = SLIDES.length;
  const pages = useMemo(() => chunkSlides(SLIDES, perView), [perView]);
  const pageCount = pages.length;
  const [page, setPage] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => setPerView(mq.matches ? 1 : DESKTOP_PER_VIEW);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    setPage((p) => Math.min(p, pageCount - 1));
  }, [pageCount]);

  const goPage = useCallback(
    (next: number) => {
      setPage(Math.max(0, Math.min(pageCount - 1, next)));
    },
    [pageCount],
  );

  const style = {
    "--per-view": perView,
    "--pages": pageCount,
  } as CSSProperties;

  return (
    <div className="product-carousel" style={style}>
      <div className="product-carousel__viewport" aria-live="polite">
        <div
          className="product-carousel__track"
          style={{ transform: `translateX(-${(page * 100) / pageCount}%)` }}
        >
          {pages.map((group, pageIndex) => (
            <div key={pageIndex} className="product-carousel__page">
              {group.map((slide) => (
                <article key={slide.title} className="product-carousel__slide">
                  <h3>{slide.title}</h3>
                  <p>{slide.body}</p>
                  <p className="product-carousel__detail">{slide.detail}</p>
                </article>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="product-carousel__controls">
        <button
          type="button"
          className="product-carousel__btn"
          aria-label="Previous slides"
          disabled={page === 0}
          onClick={() => goPage(page - 1)}
        >
          ←
        </button>
        <div className="product-carousel__dots" role="tablist" aria-label="Product slides">
          {pages.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === page}
              aria-label={`Slides ${i * perView + 1}–${Math.min((i + 1) * perView, total)}`}
              className={`product-carousel__dot${i === page ? " on" : ""}`}
              onClick={() => goPage(i)}
            />
          ))}
        </div>
        <button
          type="button"
          className="product-carousel__btn"
          aria-label="Next slides"
          disabled={page === pageCount - 1}
          onClick={() => goPage(page + 1)}
        >
          →
        </button>
      </div>
    </div>
  );
}
