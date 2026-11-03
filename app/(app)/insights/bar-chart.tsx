"use client";

import { useEffect, useRef, useState } from "react";

export type Bar = { key: string; label: string; value: number; detail: string };

// One series of columns from a single baseline: thin bars (24 px at most),
// a 4 px rounded top, hairline gridlines, a tooltip on hover or focus.
// The title outside says what's plotted, so there's no legend. Drawn at
// the width it's shown at, so the labels are real 11 px on any screen.
export function BarChart({ bars, height = 200, valueName }: { bars: Bar[]; height?: number; valueName: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pad = { top: 12, right: 8, bottom: 26, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const slot = plotW / Math.max(1, bars.length);
  const barW = Math.max(2, Math.min(24, slot - 2));
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const labelEvery = Math.ceil(bars.length / Math.max(2, Math.floor(plotW / 56)));
  const fmt = (n: number) => (top >= 10_000 ? new Intl.NumberFormat("en-US", { notation: "compact" }).format(n) : n.toLocaleString("en-US"));

  return (
    <div ref={box} className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block max-w-full" role="img" aria-label={`${valueName} by day`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={pad.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--color-ink-soft)">
              {fmt(t)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = pad.left + i * slot + (slot - barW) / 2;
          const h = Math.max(0, y(0) - y(b.value));
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={b.key}>
              {h > 0 && (
                <path
                  d={`M${x},${y(0)} V${y(b.value) + r} Q${x},${y(b.value)} ${x + r},${y(b.value)} H${x + barW - r} Q${x + barW},${y(b.value)} ${x + barW},${y(b.value) + r} V${y(0)} Z`}
                  fill="var(--color-chart)"
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              {/* the hit target: the whole slot, taller than the bar */}
              <rect
                x={pad.left + i * slot}
                y={pad.top}
                width={slot}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${b.label}: ${b.detail}`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
              {i % labelEvery === 0 && (
                <text x={pad.left + i * slot + slot / 2} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--color-ink-soft)">
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="var(--color-ink-soft)" strokeWidth={1} />
      </svg>
      {hover !== null && bars[hover] && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${((pad.left + hover * slot + slot / 2) / width) * 100}%`, top: `${(y(bars[hover].value) / height) * 100}%` }}
        >
          <p className="font-semibold">{bars[hover].label}</p>
          <p className="text-ink-soft">{bars[hover].detail}</p>
        </div>
      )}
    </div>
  );
}

// 1, 2 or 5 times a power of ten, giving four or five gridlines.
function niceStep(max: number) {
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const n = rough / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
