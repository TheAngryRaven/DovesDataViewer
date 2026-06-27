// Pure grouping for the driver profile page (plan 0006): one user's approved
// leaderboard entries → Course → weight buckets → ranked laps. Simpler than the
// full Leaderboards browse tree (no track level, weight always split, no top-N) —
// the profile just answers "what has this driver posted, by course and weight".
// No React / network so it stays unit-testable.

import type { EngineClass, LeaderboardEntry } from "./leaderboardTypes";
import { engineLabelFor } from "./leaderboardBrowse";

export interface DriverLap {
  id: string;
  engineLabel: string;
  lapTimeMs: number;
}

export interface DriverWeightGroup {
  /** Stable key within the course (weight+unit, or "none"). */
  key: string;
  /** "165 lb" etc., or null when the entry carried no listed weight. */
  weightLabel: string | null;
  /** Laps fastest-first. */
  laps: DriverLap[];
  fastestMs: number;
}

export interface DriverCourseGroup {
  courseKey: string;
  courseName: string;
  trackName: string;
  fastestMs: number;
  recordCount: number;
  weightGroups: DriverWeightGroup[];
}

function weightKey(e: LeaderboardEntry): string {
  return e.listedWeight == null ? "none" : `${e.listedWeight}|${e.listedWeightUnit ?? "lb"}`;
}

function weightLabel(e: LeaderboardEntry): string | null {
  if (e.listedWeight == null) return null;
  return `${e.listedWeight} ${e.listedWeightUnit ?? "lb"}`;
}

const fastestOf = (es: { lapTimeMs: number }[]) =>
  es.reduce((m, e) => Math.min(m, e.lapTimeMs), Infinity);

/** Group a driver's entries by course, then by exact listed weight, each fastest-first. */
export function groupEntriesByCourseWeight(
  entries: LeaderboardEntry[],
  classes: EngineClass[],
): DriverCourseGroup[] {
  const classesById = new Map(classes.map((c) => [c.id, c]));

  interface Bucket {
    courseName: string;
    trackName: string;
    weights: Map<string, LeaderboardEntry[]>;
  }
  const courses = new Map<string, Bucket>();
  for (const e of entries) {
    const bucket = courses.get(e.courseKey) ?? {
      courseName: e.courseName,
      trackName: e.trackName,
      weights: new Map<string, LeaderboardEntry[]>(),
    };
    courses.set(e.courseKey, bucket);
    const wk = weightKey(e);
    const list = bucket.weights.get(wk) ?? [];
    bucket.weights.set(wk, list);
    list.push(e);
  }

  const result: DriverCourseGroup[] = [];
  for (const [courseKey, bucket] of courses) {
    const weightGroups: DriverWeightGroup[] = [];
    let recordCount = 0;
    for (const [wk, es] of bucket.weights) {
      recordCount += es.length;
      const ranked = [...es].sort((a, b) => a.lapTimeMs - b.lapTimeMs);
      weightGroups.push({
        key: wk,
        weightLabel: weightLabel(es[0]),
        laps: ranked.map((e) => ({
          id: e.id,
          engineLabel: engineLabelFor(e, classesById),
          lapTimeMs: e.lapTimeMs,
        })),
        fastestMs: fastestOf(es),
      });
    }
    weightGroups.sort((a, b) => a.fastestMs - b.fastestMs);
    result.push({
      courseKey,
      courseName: bucket.courseName,
      trackName: bucket.trackName,
      fastestMs: weightGroups.reduce((m, w) => Math.min(m, w.fastestMs), Infinity),
      recordCount,
      weightGroups,
    });
  }

  result.sort((a, b) => a.fastestMs - b.fastestMs);
  return result;
}
