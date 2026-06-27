// Pure aggregation of light leaderboard rows → the Track → Course → engine/weight
// browse tree (plan 0005). No React / network so the grouping + counting stays
// unit-testable. Engine grouping collapses by admin class when classified, else by
// the normalized raw engine; the "group by weight" toggle further splits by exact
// listed weight.

import type { EngineClass, LeaderboardEntry } from "./leaderboardTypes";

/** One ranked entry within a group (for the leaderboard list level). */
export interface GroupEntry {
  id: string;
  userId: string;
  displayName: string;
  lapTimeMs: number;
}

export interface GroupNode {
  /** Stable key for this group within its course (engine[/weight]). */
  key: string;
  /** Display label (class name or raw engine, + weight when grouped by weight). */
  label: string;
  engineLabel: string;
  weightLabel?: string;
  /** Entry ids, fastest-first. */
  entryIds: string[];
  /** Ranked entries (fastest-first) for the leaderboard list. */
  entries: GroupEntry[];
  recordCount: number;
  fastestMs: number;
}

export interface CourseNode {
  courseName: string;
  courseKey: string;
  recordCount: number;
  engineCount: number;
  fastestMs: number;
  groups: GroupNode[];
}

export interface TrackNode {
  trackName: string;
  recordCount: number;
  engineCount: number;
  fastestMs: number;
  courses: CourseNode[];
}

/** The engine label for an entry: its admin class name, else the raw engine. */
export function engineLabelFor(
  entry: LeaderboardEntry,
  classesById: Map<string, EngineClass>,
): string {
  if (entry.engineClassId) {
    const cls = classesById.get(entry.engineClassId);
    if (cls) return cls.name;
  }
  return entry.engine;
}

/** The grouping key for an entry's engine (class id when classified, else raw key). */
function engineGroupKey(entry: LeaderboardEntry): string {
  return entry.engineClassId ? `class:${entry.engineClassId}` : `raw:${entry.engineKey}`;
}

function weightLabel(entry: LeaderboardEntry): string | undefined {
  if (entry.listedWeight == null) return undefined;
  return `${entry.listedWeight} ${entry.listedWeightUnit ?? "lb"}`;
}

/**
 * Build the browse tree. `groupByWeight` additionally splits each engine group by
 * exact listed weight (no class math — exact match only). Tracks, courses and
 * groups are each ordered by fastest lap.
 */
export function buildBrowseTree(
  entries: LeaderboardEntry[],
  classes: EngineClass[],
  groupByWeight: boolean,
): TrackNode[] {
  const classesById = new Map(classes.map((c) => [c.id, c]));

  // track → course → group → entries
  const tracks = new Map<string, Map<string, Map<string, LeaderboardEntry[]>>>();
  for (const e of entries) {
    const courses = tracks.get(e.trackName) ?? new Map();
    tracks.set(e.trackName, courses);
    const groups = courses.get(e.courseKey) ?? new Map();
    courses.set(e.courseKey, groups);
    const gkey = groupByWeight ? `${engineGroupKey(e)}|${e.listedWeight ?? "?"}|${e.listedWeightUnit ?? ""}` : engineGroupKey(e);
    const list = groups.get(gkey) ?? [];
    groups.set(gkey, list);
    list.push(e);
  }

  const fastest = (es: LeaderboardEntry[]) => es.reduce((m, e) => Math.min(m, e.lapTimeMs), Infinity);

  const trackNodes: TrackNode[] = [];
  for (const [trackName, courses] of tracks) {
    const courseNodes: CourseNode[] = [];
    const trackEngineKeys = new Set<string>();
    let trackRecords = 0;
    let trackFastest = Infinity;

    for (const [courseKey, groups] of courses) {
      const groupNodes: GroupNode[] = [];
      const courseEngineKeys = new Set<string>();
      let courseRecords = 0;
      let courseFastest = Infinity;
      let courseName = "";

      for (const [gkey, es] of groups) {
        const sample = es[0];
        courseName = sample.courseName;
        courseEngineKeys.add(engineGroupKey(sample));
        trackEngineKeys.add(engineGroupKey(sample));
        const f = fastest(es);
        courseRecords += es.length;
        courseFastest = Math.min(courseFastest, f);
        const eng = engineLabelFor(sample, classesById);
        const wl = groupByWeight ? weightLabel(sample) : undefined;
        const ranked = [...es].sort((a, b) => a.lapTimeMs - b.lapTimeMs);
        groupNodes.push({
          key: gkey,
          label: wl ? `${eng} · ${wl}` : eng,
          engineLabel: eng,
          weightLabel: wl,
          entryIds: ranked.map((e) => e.id),
          entries: ranked.map((e) => ({ id: e.id, userId: e.userId, displayName: e.displayName, lapTimeMs: e.lapTimeMs })),
          recordCount: es.length,
          fastestMs: f,
        });
      }

      groupNodes.sort((a, b) => a.fastestMs - b.fastestMs);
      trackRecords += courseRecords;
      trackFastest = Math.min(trackFastest, courseFastest);
      courseNodes.push({
        courseName,
        courseKey,
        recordCount: courseRecords,
        engineCount: courseEngineKeys.size,
        fastestMs: courseFastest,
        groups: groupNodes,
      });
    }

    courseNodes.sort((a, b) => a.fastestMs - b.fastestMs);
    trackNodes.push({
      trackName,
      recordCount: trackRecords,
      engineCount: trackEngineKeys.size,
      fastestMs: trackFastest,
      courses: courseNodes,
    });
  }

  trackNodes.sort((a, b) => a.fastestMs - b.fastestMs);
  return trackNodes;
}
