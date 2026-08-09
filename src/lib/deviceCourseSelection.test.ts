import { describe, it, expect } from "vitest";
import {
  NO_OVERRIDES,
  keepsOnlyNewest,
  newestCourseIndex,
  overridesFromSelection,
  resolveDeviceCourses,
  selectedDeviceCourses,
} from "./deviceCourseSelection";
import type { Course } from "@/types/racing";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    name: "Full CW",
    startFinishA: { lat: 35.4, lon: -97.3 },
    startFinishB: { lat: 35.4001, lon: -97.3001 },
    isUserDefined: true,
    ...overrides,
  };
}

function sprint(name: string, dateCreated?: string): Course {
  return makeCourse({
    name,
    type: "sprint",
    finish: { a: { lat: 35.41, lon: -97.31 }, b: { lat: 35.41, lon: -97.32 } },
    dateCreated,
  });
}

const names = (courses: Course[]) => courses.map(c => c.name);

// ─── newestCourseIndex ───────────────────────────────────────────────────────

describe("newestCourseIndex", () => {
  it("returns -1 for no courses", () => {
    expect(newestCourseIndex([])).toBe(-1);
  });

  it("picks the highest stamp, not the last course", () => {
    const courses = [
      sprint("Jan", "2026-01-04T09:00"),
      sprint("Aug", "2026-08-09T14:32"),
      sprint("Mar", "2026-03-21T11:15"),
    ];
    expect(newestCourseIndex(courses)).toBe(1);
  });

  // The stamps are compared as plain strings, exactly as the firmware does, so
  // the zero-padded ISO shape is load-bearing. A naive comparison would put
  // "2026-1-4" after "2026-08-09"; the fixtures pin the padded form.
  it("orders correctly across month and day boundaries", () => {
    const courses = [
      sprint("Sep", "2026-09-01T08:00"),
      sprint("Oct", "2026-10-01T08:00"),
    ];
    expect(newestCourseIndex(courses)).toBe(1);
  });

  it("separates two courses walked on the same day by time", () => {
    const courses = [
      sprint("Morning", "2026-08-09T09:05"),
      sprint("Afternoon", "2026-08-09T14:32"),
    ];
    expect(newestCourseIndex(courses)).toBe(1);
  });

  // A missing stamp predates the field. Treating it as newest would let an old
  // import displace the course actually walked this morning.
  it("sorts a course with no stamp as the oldest", () => {
    const courses = [sprint("Stamped", "2026-08-09T14:32"), sprint("Bare")];
    expect(newestCourseIndex(courses)).toBe(0);
  });

  it("still returns a course when none of them are stamped", () => {
    const courses = [sprint("A"), sprint("B")];
    expect(newestCourseIndex(courses)).toBe(1);
  });

  it("breaks an exact tie toward the most recently added", () => {
    const courses = [
      sprint("First", "2026-08-09T14:32"),
      sprint("Second", "2026-08-09T14:32"),
    ];
    expect(newestCourseIndex(courses)).toBe(1);
  });
});

// ─── keepsOnlyNewest ─────────────────────────────────────────────────────────

describe("keepsOnlyNewest", () => {
  it("is true for a sprint track, whose courses accumulate every event", () => {
    expect(keepsOnlyNewest([sprint("Run 1"), sprint("Run 2")])).toBe(true);
  });

  it("is false for a circuit track, whose layouts are all still driven", () => {
    expect(keepsOnlyNewest([makeCourse({ name: "CW" }), makeCourse({ name: "CCW" })])).toBe(false);
  });

  it("is false for an empty track", () => {
    expect(keepsOnlyNewest([])).toBe(false);
  });
});

// ─── resolveDeviceCourses — the default rule ─────────────────────────────────

describe("resolveDeviceCourses (default rule)", () => {
  it("keeps every course of a circuit track", () => {
    const courses = [makeCourse({ name: "CW" }), makeCourse({ name: "CCW" })];
    expect(names(selectedDeviceCourses(courses))).toEqual(["CW", "CCW"]);
  });

  it("keeps only the newest course of a sprint track", () => {
    const courses = [
      sprint("Jan", "2026-01-04T09:00"),
      sprint("Aug", "2026-08-09T14:32"),
      sprint("Mar", "2026-03-21T11:15"),
    ];
    expect(names(selectedDeviceCourses(courses))).toEqual(["Aug"]);
  });

  it("preserves the original order of the courses it reports on", () => {
    const courses = [sprint("A", "2026-01-01T00:00"), sprint("B", "2026-02-01T00:00")];
    expect(resolveDeviceCourses(courses).map(d => d.course.name)).toEqual(["A", "B"]);
  });

  it("marks default decisions as such", () => {
    const courses = [sprint("Old", "2026-01-01T00:00"), sprint("New", "2026-02-01T00:00")];
    expect(resolveDeviceCourses(courses).map(d => d.why)).toEqual(["default", "default"]);
  });

  it("handles an empty course list", () => {
    expect(resolveDeviceCourses([])).toEqual([]);
  });

  // This is the property that lets the override store be device-local and
  // unsynced: on a browser that has never seen this logger, the rule alone must
  // produce a set the device can hold, so the sync flow settles instead of
  // prompting on every connect.
  it("needs no stored state to produce a device-sized set", () => {
    const courses = Array.from({ length: 30 }, (_, i) =>
      sprint(`Run ${i}`, `2026-08-${String(i + 1).padStart(2, "0")}T09:00`),
    );
    expect(selectedDeviceCourses(courses, NO_OVERRIDES)).toHaveLength(1);
  });
});

// ─── resolveDeviceCourses — overrides ────────────────────────────────────────

describe("resolveDeviceCourses (overrides)", () => {
  const sprintCourses = () => [
    sprint("Old", "2026-01-04T09:00"),
    sprint("New", "2026-08-09T14:32"),
  ];

  it("an explicit include re-adds an older sprint course", () => {
    const selected = selectedDeviceCourses(sprintCourses(), { include: ["Old"], exclude: [] });
    expect(names(selected)).toEqual(["Old", "New"]);
  });

  it("an explicit exclude drops a course the rule would keep", () => {
    const selected = selectedDeviceCourses(sprintCourses(), { include: [], exclude: ["New"] });
    expect(names(selected)).toEqual([]);
  });

  it("an exclude drops a circuit course the rule keeps by default", () => {
    const courses = [makeCourse({ name: "CW" }), makeCourse({ name: "CCW" })];
    const selected = selectedDeviceCourses(courses, { include: [], exclude: ["CCW"] });
    expect(names(selected)).toEqual(["CW"]);
  });

  it("marks overridden decisions as user decisions", () => {
    const decisions = resolveDeviceCourses(sprintCourses(), { include: ["Old"], exclude: [] });
    expect(decisions.map(d => d.why)).toEqual(["user", "default"]);
  });

  // Exclude is the direction that keeps a file under the device's buffer, and
  // the cost of getting it wrong is a track that stops being detected at all.
  it("exclude wins when a course is named in both lists", () => {
    const selected = selectedDeviceCourses(sprintCourses(), {
      include: ["New"],
      exclude: ["New"],
    });
    expect(names(selected)).toEqual([]);
  });

  it("ignores an override naming a course that no longer exists", () => {
    const selected = selectedDeviceCourses(sprintCourses(), {
      include: ["Deleted"],
      exclude: ["Renamed"],
    });
    expect(names(selected)).toEqual(["New"]);
  });
});

// ─── overridesFromSelection ──────────────────────────────────────────────────

describe("overridesFromSelection", () => {
  const sprintCourses = () => [
    sprint("Old", "2026-01-04T09:00"),
    sprint("New", "2026-08-09T14:32"),
  ];

  // A track the user never curated must stay on the default rule forever,
  // rather than being frozen to whatever it looked like when they opened the
  // picker and pressed OK.
  it("records nothing when the selection matches the default rule", () => {
    expect(overridesFromSelection(sprintCourses(), ["New"])).toEqual({
      include: [],
      exclude: [],
    });
  });

  it("records only the genuine deviations", () => {
    expect(overridesFromSelection(sprintCourses(), ["Old", "New"])).toEqual({
      include: ["Old"],
      exclude: [],
    });
  });

  it("records an exclude when the user unchecks a default-on course", () => {
    const courses = [makeCourse({ name: "CW" }), makeCourse({ name: "CCW" })];
    expect(overridesFromSelection(courses, ["CW"])).toEqual({
      include: [],
      exclude: ["CCW"],
    });
  });

  it("round-trips through resolveDeviceCourses", () => {
    const courses = sprintCourses();
    const wanted = ["Old"];
    const overrides = overridesFromSelection(courses, wanted);
    expect(names(selectedDeviceCourses(courses, overrides))).toEqual(wanted);
  });

  it("round-trips an empty selection", () => {
    const courses = sprintCourses();
    const overrides = overridesFromSelection(courses, []);
    expect(selectedDeviceCourses(courses, overrides)).toEqual([]);
  });
});
