// Side-view SVG of the kart: chassis, wheels, seat profile, and a three-
// segment stick driver whose knee is solved by 2-link IK so the feet stay on
// the pedals — the leg-coupling model made visible. The baseline (zero point)
// renders as a gray ghost behind the current position.

import { useMemo } from "react";
import { useToolsT } from "../i18n";
import {
  ZERO_ADJUSTMENTS,
  computeMassElements,
  computeCoM,
  hipPoint,
  rotateOffset,
  solveKneeIK,
  type Point,
  type SeatAdjustments,
  type SeatModelParams,
} from "./model";

// Visual-only proportions (mm). The mass model doesn't depend on these.
const THIGH_MM = 370;
const SHANK_MM = 385;
const HEAD_R_MM = 52;
const SHOULDER_DX = -276; // from the anchor, rigid with the seat
const SHOULDER_DZ = 583;
// Seat profile polyline, offsets from the front-bottom anchor.
const SEAT_PROFILE: Array<[number, number]> = [
  [15, -5],
  [-70, 12],
  [-160, 42],
  [-225, 85],
  [-258, 140],
  [-290, 275],
  [-312, 405],
];

interface FigureGeometry {
  seat: Point[];
  hip: Point;
  knee: Point;
  foot: Point;
  shoulder: Point;
  head: Point;
  com: Point;
}

function buildFigure(p: SeatModelParams, adj: SeatAdjustments): FigureGeometry {
  const anchor: Point = { x: p.anchorXMm + adj.slideMm, z: p.anchorZMm };
  const place = (dx: number, dz: number): Point => {
    const r = rotateOffset(dx, dz, adj.tiltDeg);
    return { x: anchor.x + r.x, z: anchor.z + r.z };
  };
  const seat = SEAT_PROFILE.map(([dx, dz]) => place(dx, dz));
  const hip = hipPoint(p, adj);
  const foot: Point = { x: p.wheelbaseMm - 80, z: 140 };
  const knee = solveKneeIK(hip, foot, THIGH_MM, SHANK_MM);
  const shoulder = place(SHOULDER_DX, SHOULDER_DZ);
  const len = Math.hypot(shoulder.x - hip.x, shoulder.z - hip.z) || 1;
  const head: Point = {
    x: shoulder.x + ((shoulder.x - hip.x) / len) * (HEAD_R_MM + 25),
    z: shoulder.z + ((shoulder.z - hip.z) / len) * (HEAD_R_MM + 25),
  };
  const com = computeCoM(computeMassElements(p, adj));
  return { seat, hip, knee, foot, shoulder, head, com: { x: com.xMm, z: com.zMm } };
}

function Figure({ g, ghost }: { g: FigureGeometry; ghost?: boolean }) {
  const cls = ghost ? "text-muted-foreground/40" : "text-foreground";
  const pts = (list: Point[]) => list.map((q) => `${q.x},${-q.z}`).join(" ");
  return (
    <g className={cls} stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* seat profile */}
      <polyline points={pts(g.seat)} strokeWidth={ghost ? 14 : 18} className={ghost ? undefined : "text-primary"} />
      {/* legs: shank then thigh (foot stays on the pedals) */}
      <polyline points={pts([g.foot, g.knee, g.hip])} strokeWidth={12} />
      {/* torso */}
      <line x1={g.hip.x} y1={-g.hip.z} x2={g.shoulder.x} y2={-g.shoulder.z} strokeWidth={12} />
      <circle cx={g.head.x} cy={-g.head.z} r={HEAD_R_MM} strokeWidth={10} />
    </g>
  );
}

function ComCrosshair({ p, ghost }: { p: Point; ghost?: boolean }) {
  const cls = ghost ? "text-muted-foreground/50" : "text-warning";
  return (
    <g className={cls} stroke="currentColor" fill="none" strokeWidth={6}>
      <circle cx={p.x} cy={-p.z} r={26} />
      <line x1={p.x - 40} y1={-p.z} x2={p.x + 40} y2={-p.z} />
      <line x1={p.x} y1={-p.z - 40} x2={p.x} y2={-p.z + 40} />
    </g>
  );
}

export function SeatDiagram({ params, adjustments }: { params: SeatModelParams; adjustments: SeatAdjustments }) {
  const t = useToolsT();
  const current = useMemo(() => buildFigure(params, adjustments), [params, adjustments]);
  const baseline = useMemo(() => buildFigure(params, ZERO_ADJUSTMENTS), [params]);
  const isAtZero = adjustments.slideMm === 0 && adjustments.tiltDeg === 0;

  const L = params.wheelbaseMm;
  const rearR = 139;
  const frontR = 129;
  const minX = -260;
  const width = L + 540;
  const topZ = 820;

  return (
    <svg
      viewBox={`${minX} ${-topZ} ${width} ${topZ + 70}`}
      className="w-full h-auto"
      role="img"
      aria-label={t("seat.diagramAria")}
    >
      {/* ground */}
      <line x1={minX} y1={0} x2={minX + width} y2={0} className="text-border" stroke="currentColor" strokeWidth={6} />

      {/* chassis rail + steering column + pedal (decorative) */}
      <g className="text-muted-foreground" stroke="currentColor" fill="none" strokeLinecap="round">
        <line x1={-110} y1={-62} x2={L - 110} y2={-62} strokeWidth={14} />
        <line x1={L - 360} y1={-90} x2={L - 520} y2={-400} strokeWidth={10} />
        <circle cx={L - 540} cy={-430} r={55} strokeWidth={10} />
        <line x1={current.foot.x + 25} y1={-70} x2={current.foot.x - 5} y2={-200} strokeWidth={10} />
      </g>

      {/* wheels: rear axle at x = 0, front axle at x = L */}
      <g className="text-foreground/70" stroke="currentColor" fill="none" strokeWidth={12}>
        <circle cx={0} cy={-rearR} r={rearR} />
        <circle cx={0} cy={-rearR} r={48} />
        <circle cx={L} cy={-frontR} r={frontR} />
        <circle cx={L} cy={-frontR} r={42} />
      </g>
      <g className="text-muted-foreground" fill="currentColor" fontSize={42} textAnchor="middle">
        <text x={0} y={52}>R</text>
        <text x={L} y={52}>F</text>
      </g>

      {/* baseline ghost (zero point) */}
      {!isAtZero && (
        <>
          <Figure g={baseline} ghost />
          <ComCrosshair p={baseline.com} ghost />
        </>
      )}

      {/* current position */}
      <Figure g={current} />
      {/* tilt anchor — the rotation pivot at the front-bottom seat edge */}
      <circle
        cx={params.anchorXMm + adjustments.slideMm}
        cy={-params.anchorZMm}
        r={14}
        className="text-warning"
        fill="currentColor"
      />
      <ComCrosshair p={current.com} />
    </svg>
  );
}

export default SeatDiagram;
