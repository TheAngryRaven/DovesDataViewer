// Overhead toe widget (plan 0011, phase 2): the two front wheels seen from
// above, steered by their per-side toe angles. Angles are exaggerated so a
// couple of millimetres reads visually; numbers carry the truth.

import { toeDegFromMm } from "./toe";

interface OverheadToeViewProps {
  leftToeMm: number;
  rightToeMm: number;
  lRimMm: number;
  /** "TOE OUT" / "TOE IN" / neutral caption, localized by the parent. */
  caption: string;
}

const EXAGGERATION = 6;

export function OverheadToeView({ leftToeMm, rightToeMm, lRimMm, caption }: OverheadToeViewProps) {
  const leftDeg = toeDegFromMm(leftToeMm, lRimMm) * EXAGGERATION;
  const rightDeg = toeDegFromMm(rightToeMm, lRimMm) * EXAGGERATION;

  // Toe OUT (negative) = leading edges apart: left wheel noses left (negative
  // screen rotation), right wheel noses right.
  return (
    <svg viewBox="0 0 120 80" className="w-full max-w-[220px] mx-auto" aria-hidden>
      {/* Direction of travel */}
      <line x1={60} y1={70} x2={60} y2={14} className="stroke-border" strokeWidth={1} strokeDasharray="3 3" />
      <path d="M 57 16 L 63 16 L 60 9 Z" className="fill-muted-foreground" />
      <g transform={`rotate(${leftDeg} 30 40)`}>
        <rect x={24} y={20} width={12} height={40} rx={3} className="fill-destructive/25 stroke-destructive" strokeWidth={1.5} />
        <line x1={30} y1={26} x2={30} y2={20} className="stroke-destructive" strokeWidth={2} />
      </g>
      <g transform={`rotate(${-rightDeg} 90 40)`}>
        <rect x={84} y={20} width={12} height={40} rx={3} className="fill-primary/25 stroke-primary" strokeWidth={1.5} />
        <line x1={90} y1={26} x2={90} y2={20} className="stroke-primary" strokeWidth={2} />
      </g>
      <text x={60} y={78} textAnchor="middle" className="fill-muted-foreground" style={{ font: "7px JetBrains Mono, monospace" }}>
        {caption}
      </text>
    </svg>
  );
}
