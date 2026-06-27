import { describe, it, expect } from "vitest";
import { groupEntriesByCourseWeight } from "./driverProfileGroups";
import type { EngineClass, LeaderboardEntry } from "./leaderboardTypes";

function entry(over: Partial<LeaderboardEntry>): LeaderboardEntry {
  return {
    id: "e",
    userId: "u",
    displayName: "Racer",
    trackName: "Track A",
    courseName: "Course 1",
    courseKey: "ck1",
    engine: "X30",
    engineKey: "x30",
    engineClassId: null,
    listedWeight: 165,
    listedWeightUnit: "lb",
    lapTimeMs: 60000,
    contentHash: "h",
    engineTelemetryPublic: false,
    status: "approved",
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const classes: EngineClass[] = [{ id: "c1", name: "Senior", keywords: [], sortOrder: 0 }];

describe("groupEntriesByCourseWeight", () => {
  it("returns nothing for no entries", () => {
    expect(groupEntriesByCourseWeight([], classes)).toEqual([]);
  });

  it("groups by course then by exact weight, fastest-first", () => {
    const groups = groupEntriesByCourseWeight(
      [
        entry({ id: "a", lapTimeMs: 61000, listedWeight: 165 }),
        entry({ id: "b", lapTimeMs: 59000, listedWeight: 165 }),
        entry({ id: "c", lapTimeMs: 58000, listedWeight: 180 }),
      ],
      classes,
    );
    expect(groups).toHaveLength(1);
    const course = groups[0];
    expect(course.courseKey).toBe("ck1");
    expect(course.recordCount).toBe(3);
    // Two weight buckets; the 180 lb bucket is faster so it sorts first.
    expect(course.weightGroups.map((w) => w.weightLabel)).toEqual(["180 lb", "165 lb"]);
    // Laps within the 165 bucket are ranked fastest-first.
    const w165 = course.weightGroups.find((w) => w.weightLabel === "165 lb")!;
    expect(w165.laps.map((l) => l.id)).toEqual(["b", "a"]);
  });

  it("orders courses by fastest lap and labels engine via class", () => {
    const groups = groupEntriesByCourseWeight(
      [
        entry({ id: "slow", courseKey: "ckSlow", courseName: "Slow", lapTimeMs: 90000 }),
        entry({ id: "fast", courseKey: "ckFast", courseName: "Fast", lapTimeMs: 50000, engineClassId: "c1" }),
      ],
      classes,
    );
    expect(groups.map((g) => g.courseKey)).toEqual(["ckFast", "ckSlow"]);
    expect(groups[0].weightGroups[0].laps[0].engineLabel).toBe("Senior");
  });

  it("buckets entries with no listed weight under a null label", () => {
    const groups = groupEntriesByCourseWeight(
      [entry({ id: "x", listedWeight: null, listedWeightUnit: null })],
      classes,
    );
    expect(groups[0].weightGroups[0].weightLabel).toBeNull();
    expect(groups[0].weightGroups[0].key).toBe("none");
  });
});
