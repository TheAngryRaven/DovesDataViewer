// Transpose leaderboard entries → one synthetic ParsedData session (plan 0005).
//
// Each submitted entry is one frozen lap. We stack their clean-lap samples end to
// end with cumulative time offsets (fastest entry → lap 1, slowest → lap N) and
// emit one injected Lap per entry. The read-only viewer uses these laps verbatim
// (it does NOT re-run crossing detection — the concatenated multi-driver samples
// would never lap-detect sanely). Pure (no React / no IndexedDB) for testability.

import type {
  CourseDirection,
  Course,
  FieldMapping,
  GpsSample,
  Lap,
  ParsedData,
  TrackCourseSelection,
} from "@/types/racing";
import { calculateBounds } from "./parserUtils";
import type { LeaderboardEntry } from "./leaderboardTypes";

/** A small visual gap inserted between consecutive laps in the stacked timeline. */
const LAP_GAP_MS = 1000;

/** Course/engine/weight context shown above the read-only lap table. */
export interface LeaderboardDescriptor {
  courseName: string;
  engineLabel: string;
  weightLabel?: string;
}

export interface LeaderboardSessionBundle {
  data: ParsedData;
  course: Course;
  selection: TrackCourseSelection;
  laps: Lap[];
  /** lapNumber → submitter display name (the public lap label). */
  lapLabels: Record<number, string>;
  descriptor: LeaderboardDescriptor;
}

/**
 * Build a read-only session from a group's entries. Entries without a `data`
 * payload are skipped; the rest are sorted fastest-first. Returns null when no
 * entry carries usable samples.
 */
export function buildLeaderboardSession(
  entries: LeaderboardEntry[],
  descriptor: LeaderboardDescriptor,
): LeaderboardSessionBundle | null {
  const valid = entries
    .filter((e) => e.data && e.data.samples.length > 0)
    .sort((a, b) => a.lapTimeMs - b.lapTimeMs);
  if (valid.length === 0) return null;

  const samples: GpsSample[] = [];
  const laps: Lap[] = [];
  const lapLabels: Record<number, string> = {};
  const seenFields = new Set<string>();
  const fieldMappings: FieldMapping[] = [];
  let offset = 0;

  valid.forEach((entry, i) => {
    const lapNumber = i + 1;
    const src = entry.data!.samples;
    const baseT = src[0].t;
    const startIndex = samples.length;

    let maxMph = -Infinity;
    let minMph = Infinity;
    let maxKph = -Infinity;
    let minKph = Infinity;
    for (const s of src) {
      samples.push({ ...s, t: offset + (s.t - baseT) });
      if (s.speedMph > maxMph) maxMph = s.speedMph;
      if (s.speedMph < minMph) minMph = s.speedMph;
      if (s.speedKph > maxKph) maxKph = s.speedKph;
      if (s.speedKph < minKph) minKph = s.speedKph;
    }
    const endIndex = samples.length - 1;

    for (const fm of entry.data!.fieldMappings) {
      if (!seenFields.has(fm.name)) {
        seenFields.add(fm.name);
        fieldMappings.push(fm);
      }
    }

    laps.push({
      lapNumber,
      startTime: samples[startIndex].t,
      endTime: samples[endIndex].t,
      lapTimeMs: entry.lapTimeMs,
      maxSpeedMph: maxMph === -Infinity ? 0 : maxMph,
      maxSpeedKph: maxKph === -Infinity ? 0 : maxKph,
      minSpeedMph: minMph === Infinity ? 0 : minMph,
      minSpeedKph: minKph === Infinity ? 0 : minKph,
      startIndex,
      endIndex,
    });
    lapLabels[lapNumber] = entry.displayName;
    offset = samples[endIndex].t + LAP_GAP_MS;
  });

  const first = valid[0];
  const course = first.data!.course;
  const selection: TrackCourseSelection = {
    trackName: first.trackName,
    courseName: first.courseName,
    course,
    direction: (first.direction as CourseDirection | undefined) ?? undefined,
  };

  const data: ParsedData = {
    samples,
    fieldMappings,
    bounds: calculateBounds(samples),
    duration: samples.length > 0 ? samples[samples.length - 1].t : 0,
    dovexMetadata: {
      course: course.name,
      lapTimesMs: valid.map((e) => e.lapTimeMs),
    },
  };

  return { data, course, selection, laps, lapLabels, descriptor };
}
