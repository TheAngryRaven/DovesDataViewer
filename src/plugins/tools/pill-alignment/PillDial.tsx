// One eccentric-pill hub dial (plan 0011): SVG rendering of where to
// physically rotate a pill, with drag-to-rotate and arrow-key stepping.
//
// Screen orientation matches standing over the kart: forward is up, outboard
// points away from the centerline (screen-left for the left corner). The dot
// marks the dial angle; the offset bore circle shows where the kingpin hole
// sits for the chosen pill size.

import { useCallback, useRef } from "react";
import { holeIndex, normalizeDeg, snapToHole, type PillSize, type Side } from "./model";

interface PillDialProps {
  side: Side;
  size: PillSize;
  angleDeg: number;
  holeCount: number;
  snap: boolean;
  /** Eccentricity of the current size (mm), for the bore-offset visual. */
  eccentricityMm: number;
  maxEccentricityMm: number;
  onAngle: (angleDeg: number) => void;
  ariaLabel: string;
  disabled?: boolean;
}

const VIEW = 100;
const C = VIEW / 2;
const HUB_R = 44;
const HOLE_RING_R = 36;
const BORE_R = 15;

export function PillDial({
  side,
  size,
  angleDeg,
  holeCount,
  snap,
  eccentricityMm,
  maxEccentricityMm,
  onAngle,
  ariaLabel,
  disabled,
}: PillDialProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Dial angle (0°=forward, + toward outboard) → screen point at radius r.
  const toScreen = useCallback(
    (deg: number, r: number): { x: number; y: number } => {
      const rad = (deg * Math.PI) / 180;
      const fwd = Math.cos(rad);
      const out = Math.sin(rad);
      return { x: C + (side === "left" ? -out : out) * r, y: C - fwd * r };
    },
    [side],
  );

  const angleFromPointer = useCallback(
    (clientX: number, clientY: number): number => {
      const svg = svgRef.current;
      if (!svg) return angleDeg;
      const rect = svg.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * VIEW - C;
      const y = ((clientY - rect.top) / rect.height) * VIEW - C;
      const fwd = -y;
      const out = side === "left" ? -x : x;
      const deg = normalizeDeg((Math.atan2(out, fwd) * 180) / Math.PI);
      return snap ? snapToHole(deg, holeCount) : Math.round(deg);
    },
    [angleDeg, side, snap, holeCount],
  );

  const dragging = useRef(false);

  const stepDeg = holeCount > 0 ? 360 / holeCount : 5;
  const offsetPx = maxEccentricityMm > 0 ? (eccentricityMm / maxEccentricityMm) * 9 : 0;
  const boreCenter = toScreen(angleDeg, offsetPx);
  const dot = toScreen(angleDeg, HOLE_RING_R);
  const holes = holeCount > 0
    ? Array.from({ length: holeCount }, (_, i) => toScreen((i * 360) / holeCount, HOLE_RING_R))
    : [];
  const activeHole = holeIndex(angleDeg, holeCount);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={`w-full touch-none select-none ${disabled ? "opacity-50" : "cursor-pointer"}`}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.round(normalizeDeg(angleDeg))}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          onAngle(normalizeDeg(angleDeg + stepDeg));
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          onAngle(normalizeDeg(angleDeg - stepDeg));
        }
      }}
      onPointerDown={(e) => {
        if (disabled) return;
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onAngle(angleFromPointer(e.clientX, e.clientY));
      }}
      onPointerMove={(e) => {
        if (!dragging.current || disabled) return;
        onAngle(angleFromPointer(e.clientX, e.clientY));
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      {/* Hub body */}
      <circle cx={C} cy={C} r={HUB_R} className="fill-muted stroke-border" strokeWidth={1.5} />
      {/* Index holes (or a plain ring for free pills) */}
      {holes.length > 0 ? (
        holes.map((h, i) => (
          <circle
            key={i}
            cx={h.x}
            cy={h.y}
            r={2.6}
            className={i === activeHole ? "fill-primary" : "fill-background stroke-border"}
            strokeWidth={0.75}
          />
        ))
      ) : (
        <circle cx={C} cy={C} r={HOLE_RING_R} className="fill-none stroke-border" strokeWidth={0.75} strokeDasharray="2 3" />
      )}
      {/* Eccentric bore (kingpin hole), offset by the pill's eccentricity */}
      <circle cx={boreCenter.x} cy={boreCenter.y} r={BORE_R} className="fill-background stroke-foreground/60" strokeWidth={1.5} />
      {size === 0 ? (
        <circle cx={C} cy={C} r={2} className="fill-muted-foreground" />
      ) : (
        <>
          {/* Dot-direction pointer + the pill's dot itself */}
          <line x1={boreCenter.x} y1={boreCenter.y} x2={dot.x} y2={dot.y} className="stroke-primary/50" strokeWidth={1} strokeDasharray="2 2" />
          <circle cx={dot.x} cy={dot.y} r={3.4} className="fill-primary stroke-background" strokeWidth={1} />
        </>
      )}
      {/* Forward marker at 12 o'clock */}
      <path d={`M ${C - 3} 7 L ${C + 3} 7 L ${C} 2 Z`} className="fill-muted-foreground" />
    </svg>
  );
}
