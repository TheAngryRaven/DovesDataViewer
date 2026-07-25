// Chassis profile system (plan 0011): the calibration constants for a chassis,
// as a first-class record you can add to as karts get measured.
//
// Built-in profiles cover the common eccentric-pill brands but are all
// `source: "estimated"` — real eccentricities aren't published, so the values
// below are plausible placeholders sharing the same 22 mm-bore dial geometry.
// The point of the system is that a measured chassis replaces guesswork: the
// measurement helpers in the calibration panel fill in real constants, and
// "save as measured profile" freezes them as a named, reusable profile
// (persisted per-user in the plugin store). Brand names are proper nouns and
// deliberately not translated.

import { DEFAULT_CALIBRATION, type PillCalibration } from "./model";

export type ProfileSource = "estimated" | "measured";

export interface ChassisProfile {
  id: string;
  name: string;
  source: ProfileSource;
  cal: PillCalibration;
}

export const BUILTIN_PROFILES: readonly ChassisProfile[] = [
  { id: "generic", name: "Generic kart", source: "estimated", cal: DEFAULT_CALIBRATION },
  {
    id: "otk",
    name: "OTK / Tony Kart",
    source: "estimated",
    cal: { ...DEFAULT_CALIBRATION, hMm: 112, eMm: [0, 0.6, 1.2, 1.8, 2.4, 3.0], gamma0Deg: -0.4 },
  },
  {
    id: "kart-republic",
    name: "Kart Republic",
    source: "estimated",
    cal: { ...DEFAULT_CALIBRATION, hMm: 112, eMm: [0, 0.6, 1.2, 1.8, 2.4, 3.0], gamma0Deg: -0.4 },
  },
  {
    id: "compkart",
    name: "CompKart",
    source: "estimated",
    cal: { ...DEFAULT_CALIBRATION, hMm: 112, eMm: [0, 0.6, 1.2, 1.8, 2.4, 3.0] },
  },
  {
    id: "birel-art",
    name: "Birel ART",
    source: "estimated",
    cal: { ...DEFAULT_CALIBRATION, hMm: 110, eMm: [0, 0.6, 1.2, 1.8, 2.4, 3.0] },
  },
  {
    id: "praga",
    name: "Praga",
    source: "estimated",
    cal: { ...DEFAULT_CALIBRATION, hMm: 110, eMm: [0, 0.5, 1.0, 1.5, 2.0, 2.5] },
  },
  {
    id: "sodi",
    name: "Sodi",
    source: "estimated",
    cal: { ...DEFAULT_CALIBRATION, hMm: 110, eMm: [0, 0.5, 1.0, 1.5, 2.0, 2.5] },
  },
];

/** Ids the first release shipped under, mapped to their profile successors. */
const LEGACY_PRESET_IDS: Record<string, string> = { "otk-approx": "otk" };

export function migrateProfileId(id: string | null | undefined): string | null {
  if (!id) return null;
  return LEGACY_PRESET_IDS[id] ?? id;
}

export function findProfile(id: string | null, userProfiles: readonly ChassisProfile[]): ChassisProfile | null {
  if (!id) return null;
  return userProfiles.find((p) => p.id === id) ?? BUILTIN_PROFILES.find((p) => p.id === id) ?? null;
}

/**
 * Freeze the current calibration as a user profile. Ids are slugs of the name,
 * suffixed when taken, so profiles stay stable across renames of others.
 */
export function makeUserProfile(
  name: string,
  cal: PillCalibration,
  existing: readonly ChassisProfile[],
): ChassisProfile {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "measured";
  const taken = new Set([...BUILTIN_PROFILES, ...existing].map((p) => p.id));
  let id = `user-${base}`;
  for (let n = 2; taken.has(id); n++) id = `user-${base}-${n}`;
  return { id, name: name.trim() || id, source: "measured", cal: { ...cal, eMm: [...cal.eMm] } };
}

export function upsertUserProfile(
  list: readonly ChassisProfile[],
  profile: ChassisProfile,
): ChassisProfile[] {
  const next = list.filter((p) => p.id !== profile.id);
  next.push(profile);
  return next.sort((a, b) => a.name.localeCompare(b.name));
}

export function removeUserProfile(list: readonly ChassisProfile[], id: string): ChassisProfile[] {
  return list.filter((p) => p.id !== id);
}
