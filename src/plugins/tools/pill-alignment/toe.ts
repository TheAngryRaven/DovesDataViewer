// Toe model + session-setup field resolution (plan 0011, phase 2).
//
// Toe is set by the tie-rod, essentially independent of the pills at this
// fidelity. Convention follows the reference app: toe-OUT is negative, and mm
// readouts are the gauge reading across the same lRimMm span camber uses.

import type { SetupTemplate } from "@/lib/templateStorage";
import type { PillCalibration, Side, ToeState } from "./model";

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;

/** Per-side toe angle from a tie-rod length change (both sides move together). */
export function toeDegFromRod(rodDeltaMm: number, rArmMm: number): number {
  if (rArmMm <= 0) return 0;
  return Math.atan(rodDeltaMm / rArmMm) * R2D;
}

export function toeMmFromDeg(toeDeg: number, lRimMm: number): number {
  return lRimMm * Math.tan(toeDeg * D2R);
}

export function toeDegFromMm(toeMm: number, lRimMm: number): number {
  if (lRimMm <= 0) return 0;
  return Math.atan(toeMm / lRimMm) * R2D;
}

/** The static per-side toe (mm) implied by the current toe inputs. */
export function effectiveToeMm(toe: ToeState, side: Side, cal: PillCalibration): number {
  if (toe.mode === "rod") {
    return toeMmFromDeg(toeDegFromRod(toe.rodDeltaMm, toe.rArmMm), cal.lRimMm);
  }
  return side === "left" ? toe.leftToeMm : toe.rightToeMm;
}

// ---------------------------------------------------------------------------
// Session-setup field resolution
//
// The default kart template stores alignment as f-toe / f-camber / f-castor /
// f-front-width in VehicleSetup.customFields. User-created templates have
// random field ids, so fall back to case-insensitive name matching.
// ---------------------------------------------------------------------------

export interface SetupAlignmentValues {
  toe: number | null;
  camber: number | null;
  castor: number | null;
  frontWidthMm: number | null;
}

const DEFAULT_IDS: Record<keyof SetupAlignmentValues, string> = {
  toe: "f-toe",
  camber: "f-camber",
  castor: "f-castor",
  frontWidthMm: "f-front-width",
};

const NAME_MATCHERS: Record<keyof SetupAlignmentValues, RegExp> = {
  toe: /^toe\b/i,
  camber: /^camber\b/i,
  castor: /^cast(o|e)r\b/i,
  frontWidthMm: /^front\s*width\b/i,
};

/**
 * Pull alignment numbers out of a setup's customFields using its template.
 * Returns nulls for anything absent or non-numeric — callers only seed inputs
 * from non-null values.
 */
export function resolveSetupAlignmentFields(
  template: SetupTemplate | null,
  customFields: Record<string, string | number | null>,
): SetupAlignmentValues {
  const out: SetupAlignmentValues = { toe: null, camber: null, castor: null, frontWidthMm: null };

  const numeric = (v: string | number | null | undefined): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = parseFloat(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  for (const key of Object.keys(out) as Array<keyof SetupAlignmentValues>) {
    out[key] = numeric(customFields[DEFAULT_IDS[key]]);
  }

  if (template) {
    for (const section of template.sections) {
      for (const field of section.fields) {
        if (field.type !== "number") continue;
        for (const key of Object.keys(out) as Array<keyof SetupAlignmentValues>) {
          if (out[key] === null && NAME_MATCHERS[key].test(field.name.trim())) {
            out[key] = numeric(customFields[field.id]);
          }
        }
      }
    }
  }

  return out;
}
