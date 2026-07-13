"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

const DESKTOP_PER_VIEW = 3;

/* Card copy is supplied per portal tab (see PRODUCT_CARDS in app/page.tsx); the
   carousel only owns paging/layout. Each slide is a title + 1–2 paragraphs. */
export type ProductSlide = { title: string; paras: string[] };

function chunkSlides<T>(slides: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < slides.length; i += size) {
    pages.push(slides.slice(i, i + size));
  }
  return pages;
}

export default function ProductCarousel({ slides }: { slides: ProductSlide[] }) {
  const [perView, setPerView] = useState(DESKTOP_PER_VIEW);
  const total = slides.length;
  const pages = useMemo(() => chunkSlides(slides, perView), [slides, perView]);
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
                  {slide.paras.map((para, i) => (
                    <p key={i} className={i === 0 ? undefined : "product-carousel__detail"}>
                      {para}
                    </p>
                  ))}
                </article>
              ))}
            </div>
          ))}
        </div>
      </div>
      {pageCount > 1 && (
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
      )}
    </div>
  );
}
