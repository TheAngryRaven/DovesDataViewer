import { describe, expect, it } from "vitest";
import { buildBrowseTree, engineLabelFor } from "./leaderboardBrowse";
import type { EngineClass, LeaderboardEntry } from "./leaderboardTypes";

function e(over: Partial<LeaderboardEntry>): LeaderboardEntry {
  return {
    id: Math.random().toString(36).slice(2),
    userId: "u",
    displayName: "Racer",
    trackName: "OKC",
    courseName: "Full CW",
    courseKey: "OKC|Full CW",
    direction: null,
    engine: "Tillotson 225",
    engineKey: "tillotson 225",
    engineClassId: null,
    listedWeight: 365,
    listedWeightUnit: "lb",
    lapTimeMs: 62000,
    contentHash: "h",
    setupPublic: false,
    engineTelemetryPublic: false,
    status: "approved",
    createdAt: "",
    ...over,
  };
}

const classes: EngineClass[] = [
  { id: "c1", name: "Tillotson 225", keywords: ["tilly", "225"], sortOrder: 0 },
];

describe("engineLabelFor", () => {
  it("uses the class name when classified, raw engine otherwise", () => {
    const m = new Map(classes.map((c) => [c.id, c]));
    expect(engineLabelFor(e({ engineClassId: "c1", engine: "Tilly" }), m)).toBe("Tillotson 225");
    expect(engineLabelFor(e({ engineClassId: null, engine: "225RS" }), m)).toBe("225RS");
  });
});

describe("buildBrowseTree", () => {
  it("collapses different raw engines into one class group", () => {
    const tree = buildBrowseTree(
      [
        e({ engineClassId: "c1", engine: "Tilly", lapTimeMs: 63000 }),
        e({ engineClassId: "c1", engine: "225RS", lapTimeMs: 61000 }),
      ],
      classes,
      false,
    );
    expect(tree).toHaveLength(1);
    const course = tree[0].courses[0];
    expect(course.groups).toHaveLength(1);
    expect(course.groups[0].label).toBe("Tillotson 225");
    expect(course.groups[0].recordCount).toBe(2);
    expect(course.engineCount).toBe(1);
    expect(course.fastestMs).toBe(61000);
  });

  it("splits by exact weight when grouping by weight", () => {
    const tree = buildBrowseTree(
      [
        e({ engineClassId: "c1", listedWeight: 365, lapTimeMs: 62000 }),
        e({ engineClassId: "c1", listedWeight: 380, lapTimeMs: 61000 }),
      ],
      classes,
      true,
    );
    const groups = tree[0].courses[0].groups;
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe("Tillotson 225 · 380 lb"); // fastest first
    expect(groups[1].label).toBe("Tillotson 225 · 365 lb");
  });

  it("orders tracks/courses/groups by fastest lap", () => {
    const tree = buildBrowseTree(
      [
        e({ trackName: "Slow Track", lapTimeMs: 90000 }),
        e({ trackName: "Fast Track", lapTimeMs: 50000 }),
      ],
      classes,
      false,
    );
    expect(tree.map((t) => t.trackName)).toEqual(["Fast Track", "Slow Track"]);
  });
});
