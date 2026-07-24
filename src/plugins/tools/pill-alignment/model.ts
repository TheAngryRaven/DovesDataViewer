// Pill alignment forward model — pure geometry, no I/O (plan 0011).
//
// OTK-style eccentric kingpin pills: each of the two bores (top/bottom) holds
// a pill whose kingpin hole is offset from the bore centre by an eccentricity
// that depends on the pill's dot count ("size" 0–5). Rotating a pill moves the
// kingpin hole around a circle, tilting the kingpin axis → camber/caster.
//
// Per-corner frame (right-handed): x = forward, y = outboard, z = up.
// Dial convention: 0° = dot forward, positive rotation toward outboard — so
// identical dial settings on both sides give symmetric camber. The
// `mirrorRight` calibration flag negates right-side angles for users whose
// physical reference is a fixed global handedness instead.

export type Side = "left" | "right";

/** Pill dot count 0–5. 0 = concentric (no offset), 3 = OEM, 5 = max. */
export type PillSize = 0 | 1 | 2 | 3 | 4 | 5;

export const PILL_SIZES: readonly PillSize[] = [0, 1, 2, 3, 4, 5];

export interface PillCalibration {
  /** Vertical gap between the top and bottom bore centres (mm). */
  hMm: number;
  /** Kingpin-hole eccentricity per pill size (mm); eMm[0] must be 0. */
  eMm: [number, number, number, number, number, number];
  /** Built-in (concentric-pills) horizontal kingpin offset: forward (mm). Sets factory caster. */
  nXMm: number;
  /** Built-in horizontal kingpin offset: outboard (mm). Sets factory KPI/camber. */
  nYMm: number;
  /** Built-in spindle camber at concentric pills (deg). */
  gamma0Deg: number;
  /** Camber-gauge contact span for deg→mm readouts (mm, typically rim diameter). */
  lRimMm: number;
  /** Wheel-centre height as a fraction of the kingpin (0..1); weights Δtrack/Δwheelbase. */
  wheelFrac: number;
  signCamber: 1 | -1;
  signCaster: 1 | -1;
  /** Negate right-side dial angles (global-handedness angle references). */
  mirrorRight: boolean;
  /** Index holes per pill revolution; 0 = free (friction) pill. */
  holeCount: number;
  /** Heuristic toe drift per mm of fore-aft kingpin shift (mm toe per mm), for the resultant-toe color mode. */
  toeCouplingMmPerMm: number;
}

/** One corner's pill settings, in dial angles (deg). */
export interface CornerPills {
  sTop: PillSize;
  sBot: PillSize;
  thetaTopDeg: number;
  thetaBotDeg: number;
}

export interface CornerResult {
  camberDeg: number;
  casterDeg: number;
  /** Camber expressed as a gauge reading across lRimMm. */
  camberMm: number;
  /** Track-width change at this corner vs concentric pills (+ = wider). */
  trackDeltaMm: number;
  /** Wheelbase change at this corner vs concentric pills (+ = longer). */
  wheelbaseDeltaMm: number;
  /** Horizontal kingpin delta (bottom→top bore), for the inverse solver and tests. */
  dXMm: number;
  dYMm: number;
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Normalize an angle to [0, 360). */
export function normalizeDeg(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

/** Dial angle → local-frame angle (rad); right side mirrors when configured. */
export function dialToLocalRad(cal: PillCalibration, side: Side, dialDeg: number): number {
  const sign = side === "right" && cal.mirrorRight ? -1 : 1;
  return sign * dialDeg * D2R;
}

/** Local-frame angle (rad) → dial angle (deg), inverse of dialToLocalRad. */
export function localRadToDial(cal: PillCalibration, side: Side, localRad: number): number {
  const sign = side === "right" && cal.mirrorRight ? -1 : 1;
  return normalizeDeg(sign * localRad * R2D);
}

/** Snap a dial angle to the nearest index hole; holeCount 0 = free pill (identity). */
export function snapToHole(dialDeg: number, holeCount: number): number {
  if (holeCount <= 0) return normalizeDeg(dialDeg);
  const step = 360 / holeCount;
  return normalizeDeg(Math.round(dialDeg / step) * step);
}

/** Hole index (0-based) closest to a dial angle, for display next to degrees. */
export function holeIndex(dialDeg: number, holeCount: number): number {
  if (holeCount <= 0) return 0;
  return Math.round(normalizeDeg(dialDeg) / (360 / holeCount)) % holeCount;
}

/** Forward model: pill settings → camber/caster/track for one corner. */
export function forwardCorner(cal: PillCalibration, pills: CornerPills, side: Side): CornerResult {
  const et = cal.eMm[pills.sTop];
  const eb = cal.eMm[pills.sBot];
  const tt = dialToLocalRad(cal, side, pills.thetaTopDeg);
  const tb = dialToLocalRad(cal, side, pills.thetaBotDeg);

  const dX = cal.nXMm + et * Math.cos(tt) - eb * Math.cos(tb);
  const dY = cal.nYMm + et * Math.sin(tt) - eb * Math.sin(tb);

  const casterRad = cal.signCaster * Math.atan2(-dX, cal.hMm);
  const camberRad = cal.signCamber * (cal.gamma0Deg * D2R + Math.atan2(dY, cal.hMm));

  const f = cal.wheelFrac;
  return {
    camberDeg: camberRad * R2D,
    casterDeg: casterRad * R2D,
    camberMm: cal.lRimMm * Math.tan(camberRad),
    trackDeltaMm: f * et * Math.sin(tt) + (1 - f) * eb * Math.sin(tb),
    wheelbaseDeltaMm: f * et * Math.cos(tt) + (1 - f) * eb * Math.cos(tb),
    dXMm: dX,
    dYMm: dY,
  };
}

/**
 * Required kingpin delta for a camber/caster target, minus the built-in offset —
 * i.e. what the two pills together must contribute. Shared by the solvers.
 */
export function pillContribution(
  cal: PillCalibration,
  targetCamberDeg: number,
  targetCasterDeg: number,
): { rX: number; rY: number } {
  const aY = cal.signCamber * targetCamberDeg * D2R - cal.gamma0Deg * D2R;
  const aX = cal.signCaster * targetCasterDeg * D2R;
  return {
    rX: -cal.hMm * Math.tan(aX) - cal.nXMm,
    rY: cal.hMm * Math.tan(aY) - cal.nYMm,
  };
}

// ---------------------------------------------------------------------------
// Calibration defaults & presets
//
// Real OTK eccentricities are not published; these are plausible round numbers
// so the tool behaves sensibly out of the box. Everything is user-editable and
// the UI labels presets "(approx)" with an experimental disclaimer.
// ---------------------------------------------------------------------------

export const DEFAULT_CALIBRATION: PillCalibration = {
  hMm: 110,
  eMm: [0, 0.5, 1.0, 1.5, 2.0, 2.5],
  nXMm: 0,
  nYMm: 0,
  gamma0Deg: 0,
  lRimMm: 130,
  wheelFrac: 0.5,
  signCamber: 1,
  signCaster: 1,
  mirrorRight: false,
  holeCount: 20,
  toeCouplingMmPerMm: 0.5,
};

export interface ChassisPreset {
  id: string;
  cal: PillCalibration;
}

export const CHASSIS_PRESETS: readonly ChassisPreset[] = [
  { id: "generic", cal: DEFAULT_CALIBRATION },
  {
    id: "otk-approx",
    cal: { ...DEFAULT_CALIBRATION, hMm: 112, eMm: [0, 0.6, 1.2, 1.8, 2.4, 3.0], gamma0Deg: -0.4 },
  },
];

// ---------------------------------------------------------------------------
// Persisted tool state (plugin store, key "pill-alignment:v1")
// ---------------------------------------------------------------------------

export type EnvelopeColorMode = "trackDelta" | "thetaTop" | "resultantToe";

export type ToeMode = "rod" | "perSide";

export interface ToeState {
  mode: ToeMode;
  /** Tie-rod length change from baseline (mm), rod mode. */
  rodDeltaMm: number;
  /** Steering-arm effective radius (mm), rod mode. */
  rArmMm: number;
  /** Per-side toe (mm across lRimMm), OUT negative. */
  leftToeMm: number;
  rightToeMm: number;
}

export interface PersistedStateV1 {
  calibration: PillCalibration;
  /** Active preset id, or null once any constant is hand-edited. */
  presetId: string | null;
  corners: { left: CornerPills; right: CornerPills };
  /** Mirror left-side edits onto the right side. */
  linked: boolean;
  activeSide: Side;
  colorMode: EnvelopeColorMode;
  snapHoles: boolean;
  toe: ToeState;
}

export const DEFAULT_CORNER: CornerPills = { sTop: 3, sBot: 3, thetaTopDeg: 0, thetaBotDeg: 0 };

export const DEFAULT_TOE: ToeState = {
  mode: "perSide",
  rodDeltaMm: 0,
  rArmMm: 70,
  leftToeMm: 0,
  rightToeMm: 0,
};

export const DEFAULT_STATE: PersistedStateV1 = {
  calibration: DEFAULT_CALIBRATION,
  presetId: "generic",
  corners: { left: DEFAULT_CORNER, right: DEFAULT_CORNER },
  linked: true,
  activeSide: "left",
  colorMode: "trackDelta",
  snapHoles: true,
  toe: DEFAULT_TOE,
};
