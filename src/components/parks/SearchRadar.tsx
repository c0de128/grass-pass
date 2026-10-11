"use client";

/**
 * Search v2 (Kevin 2026-10-10: "the loading animation should be better"): while /api/parks works (usually a few
 * seconds, up to about 45 s when OpenStreetMap is slow), a paper-map "radar" sweeps the chosen circle around the
 * searched place. It is decoration drawn in SVG: no tiles, no pins, no park names, no progress bar (we don't know how
 * far along the server is). The words are ParkStep's own status line (the real request); this adds the seconds so far.
 * prefers-reduced-motion: no sweep and no ripples, only a slow fade of the circle (globals.css, gp-radar-*).
 * The status text for screen readers stays in ParkStep's aria-live line; this whole block is aria-hidden.
 */
import { useEffect, useState } from "react";
import { radiusShort, type RadiusMiles } from "@/lib/parks/constants";

/** The paper map's own colours (a light map in dark mode too, like the printed pass map). */
const PAPER = {
  land: "#edf4e2",
  grid: "#d5e3c4",
  road: "#ffffff",
  roadEdge: "#cdd8bd",
  water: "#bfe0f2",
  ring: "#137838",
  ringSoft: "#13783833",
  ink: "#10291a",
  sun: "#ffc72c",
} as const;

export function SearchRadar({ radiusMi }: { radiusMi: RadiusMiles }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div aria-hidden="true" data-testid="park-search-radar">
      <div className="relative overflow-hidden rounded-2xl ring-1 ring-border shadow-md shadow-shadow" style={{ background: PAPER.land }}>
        <svg viewBox="0 0 400 240" className="block h-auto w-full" role="presentation" focusable="false">
          <defs>
            <pattern id="gp-radar-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0V40" fill="none" stroke={PAPER.grid} strokeWidth="1" />
            </pattern>
            <radialGradient id="gp-radar-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={PAPER.ring} stopOpacity="0.16" />
              <stop offset="100%" stopColor={PAPER.ring} stopOpacity="0.02" />
            </radialGradient>
            <linearGradient id="gp-radar-beam" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={PAPER.ring} stopOpacity="0" />
              <stop offset="100%" stopColor={PAPER.ring} stopOpacity="0.45" />
            </linearGradient>
            <clipPath id="gp-radar-clip">
              <circle cx="200" cy="120" r="96" />
            </clipPath>
          </defs>

          {/* A plain paper sheet with a drafting grid and two soft "roads" (decoration, not a real place). */}
          <rect width="400" height="240" fill="url(#gp-radar-grid)" />
          <path d="M-10 170C80 150 140 190 230 160S360 120 410 135" fill="none" stroke={PAPER.roadEdge} strokeWidth="11" strokeLinecap="round" />
          <path d="M-10 170C80 150 140 190 230 160S360 120 410 135" fill="none" stroke={PAPER.road} strokeWidth="7" strokeLinecap="round" />
          <path d="M120 -10C130 60 170 110 160 250" fill="none" stroke={PAPER.roadEdge} strokeWidth="9" strokeLinecap="round" />
          <path d="M120 -10C130 60 170 110 160 250" fill="none" stroke={PAPER.road} strokeWidth="5" strokeLinecap="round" />
          <path d="M300 -10C280 40 330 70 320 120" fill="none" stroke={PAPER.water} strokeWidth="6" strokeLinecap="round" />

          {/* The chosen circle: soft fill, dashed edge, and its label. */}
          <g className="gp-radar-breathe">
            <circle cx="200" cy="120" r="96" fill="url(#gp-radar-glow)" />
            <circle cx="200" cy="120" r="96" fill="none" stroke={PAPER.ring} strokeWidth="2.5" strokeDasharray="7 6" />
            <circle cx="200" cy="120" r="64" fill="none" stroke={PAPER.ringSoft} strokeWidth="1.5" />
            <circle cx="200" cy="120" r="32" fill="none" stroke={PAPER.ringSoft} strokeWidth="1.5" />
          </g>

          {/* Ripples going out from the place, and the sweeping beam (motion only when the visitor allows it). */}
          <g className="gp-radar-motion">
            <circle className="gp-radar-ripple" cx="200" cy="120" r="96" fill="none" stroke={PAPER.ring} strokeWidth="2" />
            <circle className="gp-radar-ripple gp-radar-ripple-late" cx="200" cy="120" r="96" fill="none" stroke={PAPER.ring} strokeWidth="2" />
            <g clipPath="url(#gp-radar-clip)">
              <g className="gp-radar-sweep">
                <path d="M200 120L296 120A96 96 0 0 0 267.9 52.1Z" fill="url(#gp-radar-beam)" />
                <line x1="200" y1="120" x2="296" y2="120" stroke={PAPER.ring} strokeWidth="2.5" strokeLinecap="round" />
              </g>
            </g>
          </g>

          {/* The searched place. */}
          <circle cx="200" cy="120" r="13" fill={PAPER.sun} stroke={PAPER.ink} strokeWidth="3" />
          <circle cx="200" cy="120" r="4" fill={PAPER.ink} />

          {/* Distance tag on the circle's edge. */}
          <g transform="translate(200 24)">
            <rect x="-34" y="-13" width="68" height="26" rx="13" fill={PAPER.ink} />
            <text x="0" y="5" textAnchor="middle" fontSize="14" fontWeight="800" fill="#ffffff" style={{ fontFamily: "var(--font-heading)" }}>
              {radiusShort(radiusMi)}
            </text>
          </g>
        </svg>
        <p className="absolute right-2.5 bottom-2.5 rounded-full px-2.5 py-0.5 font-mono text-xs font-bold tabular-nums shadow-sm" style={{ background: "#ffffff", color: PAPER.ink }}>
          {seconds} s
        </p>
      </div>
    </div>
  );
}
