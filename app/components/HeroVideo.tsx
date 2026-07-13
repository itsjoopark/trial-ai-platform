"use client";

import { useEffect, useRef } from "react";

/**
 * Experimental video backdrop for the front-landing hero (replaces the ASCII
 * there). Muted/looping ambient texture under a warm --canvas scrim so the
 * headline and CTA stay legible; pauses under prefers-reduced-motion.
 */
export default function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (mq.matches) v.pause();
      else void v.play().catch(() => {});
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return (
    <div className="hero-video" aria-hidden="true">
      <video
        ref={ref}
        className="hero-video__el"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/trial-hero-poster.jpg"
      >
        <source src="/trial-video.mp4" type="video/mp4" />
      </video>
      <div className="hero-video__scrim" />
    </div>
  );
}
