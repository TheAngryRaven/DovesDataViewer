// Lap snapshots — frozen, single-lap "course fastest lap" captures.
//
// A snapshot freezes one lap (its GPS samples ± a 5s buffer), the course
// geometry, the engine string, and a copy of the vehicle/setup at capture time.
// It NEVER changes once saved (unless deleted); that historical immutability is
// the whole point — it's a baseline you can load and compare against any later
// session on the same course, regardless of the engine you're running now.
//
// Identity is (course + engine): the engine is the layman's "primary key" for
// the comparison, the chassis travels with the frozen setup. There's exactly one
// snapshot per (course, engine) — a faster lap replaces it in place (same id), so
// it can never inflate the stored count. This module is pure (no IndexedDB / no
// React) so the keying + buffer logic stays unit-testable.

import type { Course, CourseDirection, GpsSample, Lap } from "@/types/racing";
import type { VehicleSetup } from "./setupStorage";

/** Samples kept on each side of the lap, so a later start/finish nudge still fits. */
export const SNAPSHOT_BUFFER_MS = 5000;

// Separator for composite keys — only ever compared for equality, never split.
// ASCII unit separator (0x1F): never appears in a track / course / engine name.
const SEP = String.fromCharCode(31);

/** Frozen vehicle context stored with a snapshot (engine is the match key). */
export interface SnapshotVehicle {
  id?: string;
  name?: string;
  number?: number;
  /** Vehicle weight at capture time — the default "listed weight" for leaderboards. */
  weight?: number;
  weightUnit?: "lb" | "kg";
}

export interface LapSnapshot {
  /** Stable id derived from courseKey + engineKey — one snapshot per engine+course. */
  id: string;

  // ── Matching identity ──────────────────────────────────────────────────────
  trackName: string;
  courseName: string;
  /** Composite of track + course — indexed for per-course lookup. */
  courseKey: string;
  /** Display engine string (free-text, from the vehicle). */
  engine: string;
  /** Normalized engine (trimmed + lowercased) for matching — indexed. */
  engineKey: string;

  // ── Frozen lap payload (immutable once saved) ───────────────────────────────
  /** Course geometry at capture time, so overlays survive later course edits. */
  course: Course;
  lapTimeMs: number;
  sourceFileName: string;
  sourceLapNumber: number;
  /** Session start (epoch ms) if known — for display. */
  recordedAt?: number;
  /** Buffered samples: the actual lap ± SNAPSHOT_BUFFER_MS on each side. */
  samples: GpsSample[];
  /** `sample.t` of the actual lap start within `samples`. */
  lapStartMs: number;
  /** `sample.t` of the actual lap end within `samples`. */
  lapEndMs: number;

  // ── Frozen setup / chassis context ──────────────────────────────────────────
  vehicle?: SnapshotVehicle;
  setup?: VehicleSetup;

  // ── Bookkeeping ─────────────────────────────────────────────────────────────
  createdAt: number;
  /** Last local write (ms) — used for sync merge. */
  updatedAt: number;
}

/** Normalize an engine string so "Rotax Max", " rotax max " match. */
export function normalizeEngine(engine: string): string {
  return engine.trim().toLowerCase();
}

/**
 * Composite course identity (track + course + direction); only ever compared for
 * equality. A course driven in reverse is a different baseline — a reverse lap
 * must not overwrite the forward snapshot (and vice versa). 'forward'/undefined
 * keep the bare key so existing (pre-direction) snapshots stay addressable; only
 * 'reverse' adds a suffix.
 */
export function makeCourseKey(
  trackName: string,
  courseName: string,
  direction?: CourseDirection,
): string {
  const base = `${trackName.trim()}${SEP}${courseName.trim()}`;
  return direction === "reverse" ? `${base}${SEP}reverse` : base;
}

/** Stable snapshot id for a (course, engine) pair — same pair ⇒ same id ⇒ replace. */
export function makeSnapshotId(courseKey: string, engineKey: string): string {
  return `snap${SEP}${courseKey}${SEP}${engineKey}`;
}

export interface BuildSnapshotInput {
  lap: Lap;
  /** Full session samples (`ParsedData.samples`). */
  samples: GpsSample[];
  course: Course;
  trackName: string;
  courseName: string;
  /** Direction the course was driven — part of the snapshot identity. */
  direction?: CourseDirection;
  engine: string;
  sourceFileName: string;
  recordedAt?: number;
  vehicle?: SnapshotVehicle;
  setup?: VehicleSetup;
  /** Preserve the original capture time when replacing an existing snapshot. */
  createdAt?: number;
  now?: number;
}

/** Slice the lap from session samples with a ±5s buffer, returning a frozen snapshot. */
export function buildSnapshot(input: BuildSnapshotInput): LapSnapshot {
  const {
    lap, samples, course, trackName, courseName, direction, engine,
    sourceFileName, recordedAt, vehicle, setup,
  } = input;
  const now = input.now ?? Date.now();

  const lapStartMs = samples[lap.startIndex]?.t ?? 0;
  const lapEndMs = samples[lap.endIndex]?.t ?? lapStartMs;

  // Expand the slice outwards by the buffer window, clamped to the array.
  let startIdx = lap.startIndex;
  while (startIdx > 0 && lapStartMs - samples[startIdx - 1].t <= SNAPSHOT_BUFFER_MS) startIdx--;
  let endIdx = lap.endIndex;
  while (endIdx < samples.length - 1 && samples[endIdx + 1].t - lapEndMs <= SNAPSHOT_BUFFER_MS) endIdx++;

  const buffered = samples.slice(startIdx, endIdx + 1).map((s) => ({ ...s }));

  const courseKey = makeCourseKey(trackName, courseName, direction);
  const engineKey = normalizeEngine(engine);

  return {
    id: makeSnapshotId(courseKey, engineKey),
    trackName: trackName.trim(),
    courseName: courseName.trim(),
    courseKey,
    engine: engine.trim(),
    engineKey,
    course,
    lapTimeMs: lap.lapTimeMs,
    sourceFileName,
    sourceLapNumber: lap.lapNumber,
    recordedAt,
    samples: buffered,
    lapStartMs,
    lapEndMs,
    vehicle,
    setup,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

/** The clean lap samples (buffer trimmed) — used as the comparison overlay. */
export function snapshotLapSamples(snap: LapSnapshot): GpsSample[] {
  const clean = snap.samples.filter((s) => s.t >= snap.lapStartMs && s.t <= snap.lapEndMs);
  // Defensive: if the markers don't line up (legacy/edited data), fall back to all.
  return clean.length > 0 ? clean : snap.samples;
}

/** The fastest lap in a list (min lapTimeMs), or null when empty. */
export function fastestLap(laps: Lap[]): Lap | null {
  if (laps.length === 0) return null;
  return laps.reduce((min, l) => (l.lapTimeMs < min.lapTimeMs ? l : min), laps[0]);
}

export type SnapshotPromptKind = "new" | "faster";

/**
 * Decide whether assigning an engine to this session should prompt to save/update
 * the course fastest-lap snapshot. Returns the prompt kind, or null when the
 * existing snapshot is already as fast or faster (no prompt).
 */
export function snapshotPromptKind(
  candidateLapMs: number,
  existing: Pick<LapSnapshot, "lapTimeMs"> | null | undefined,
): SnapshotPromptKind | null {
  if (!existing) return "new";
  return candidateLapMs < existing.lapTimeMs ? "faster" : null;
}
