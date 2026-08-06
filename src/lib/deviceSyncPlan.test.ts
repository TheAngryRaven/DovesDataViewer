import { describe, it, expect } from "vitest";
import {
  buildSyncPlan,
  planHasWork,
  rowsNeedingRename,
  DEVICE_MAX_COURSES,
} from "./deviceSyncPlan";
import type { MergedTrackEntry, MergedCourseEntry, DeviceCourseJson } from "./deviceTrackSync";
import type { Course, Track } from "@/types/racing";

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

function makeSprintCourse(name = "Run"): Course {
  return makeCourse({
    name,
    type: "sprint",
    finish: { a: { lat: 35.41, lon: -97.31 }, b: { lat: 35.41, lon: -97.32 } },
  });
}

function makeDeviceCourse(name = "Full CW"): DeviceCourseJson {
  return {
    name,
    start_a_lat: 35.4,
    start_a_lng: -97.3,
    start_b_lat: 35.4001,
    start_b_lng: -97.3001,
  };
}

function makeEntry(overrides: Partial<MergedTrackEntry> = {}): MergedTrackEntry {
  const appCourses = overrides.appCourses ?? [];
  const deviceCourses = overrides.deviceCourses ?? [];
  return {
    shortName: "OKC",
    kind: "circuit",
    status: "app_only",
    appCourses,
    deviceCourses,
    mergedCourses: [],
    ...overrides,
  };
}

function appTrack(courses: Course[], overrides: Partial<Track> = {}): Track {
  return { name: "Track", shortName: "OKC", courses, isUserDefined: true, ...overrides };
}

function courseEntries(
  specs: Array<[string, MergedCourseEntry["status"]]>,
): MergedCourseEntry[] {
  return specs.map(([name, status]) => ({
    name,
    status,
    appCourse: status === "device_only" ? undefined : makeCourse({ name }),
    deviceCourse: status === "app_only" ? undefined : makeDeviceCourse(name),
  }));
}

// ─── What gets offered ───────────────────────────────────────────────────────

describe("buildSyncPlan", () => {
  it("drops synced tracks — there is nothing to do", () => {
    const plan = buildSyncPlan([makeEntry({ status: "synced" })]);
    expect(plan.rows).toEqual([]);
    expect(planHasWork(plan)).toBe(false);
  });

  it("offers a device-only track as a download", () => {
    const plan = buildSyncPlan([
      makeEntry({
        status: "device_only",
        shortName: "08031432",
        deviceLongName: "N260803_1432",
        deviceFileName: "N260803_1432.json",
        deviceCourses: [makeDeviceCourse("N260803_1432")],
        mergedCourses: courseEntries([["N260803_1432", "device_only"]]),
      }),
    ]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].direction).toBe("download");
    expect(plan.rows[0].name).toBe("N260803_1432");
    expect(plan.rows[0].deviceFileName).toBe("N260803_1432.json");
  });

  it("offers a user-defined app-only track as an upload", () => {
    const plan = buildSyncPlan([
      makeEntry({ status: "app_only", appTrack: appTrack([makeCourse()]) }),
    ]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].direction).toBe("upload");
  });

  // The app ships two reference tracks. "Unknown tracks" meant the user's, not
  // every track the app happens to know about.
  it("never offers a track the user didn't create", () => {
    const plan = buildSyncPlan([
      makeEntry({
        status: "app_only",
        appTrack: appTrack([makeCourse()], { isUserDefined: false }),
      }),
    ]);
    expect(plan.rows).toEqual([]);
    expect(plan.skipped).toEqual([]); // silently absent, not reported
  });

  it("uploads a mismatched track and still imports its device-only courses", () => {
    const plan = buildSyncPlan([
      makeEntry({
        status: "mismatch",
        appTrack: appTrack([makeCourse({ name: "A" })]),
        appCourses: [makeCourse({ name: "A" })],
        deviceCourses: [makeDeviceCourse("A"), makeDeviceCourse("Walked")],
        mergedCourses: courseEntries([
          ["A", "mismatch"],
          ["Walked", "device_only"],
        ]),
      }),
    ]);
    expect(plan.rows[0].direction).toBe("upload");
    expect(plan.rows[0].deviceOnlyCourses.map((c) => c.name)).toEqual(["Walked"]);
  });

  it("lists only the courses that actually differ", () => {
    const plan = buildSyncPlan([
      makeEntry({
        status: "mismatch",
        appTrack: appTrack([makeCourse()]),
        mergedCourses: courseEntries([
          ["Same", "synced"],
          ["Changed", "mismatch"],
          ["New", "device_only"],
        ]),
      }),
    ]);
    expect(plan.rows[0].courses.map((c) => c.name)).toEqual(["Changed", "New"]);
    expect(plan.rows[0].courses.map((c) => c.direction)).toEqual(["upload", "download"]);
  });
});

// ─── Rename detection ────────────────────────────────────────────────────────

describe("buildSyncPlan rename flags", () => {
  it("flags a track whose long name is a device placeholder", () => {
    const plan = buildSyncPlan([
      makeEntry({
        status: "device_only",
        shortName: "08031432",
        deviceLongName: "N260803_1432",
      }),
    ]);
    expect(plan.rows[0].needsRename).toBe(true);
    expect(rowsNeedingRename(plan)).toHaveLength(1);
  });

  // The two halves are independent — a user can fix one and leave the other.
  it("flags a track whose short name alone is a placeholder", () => {
    const plan = buildSyncPlan([
      makeEntry({ status: "device_only", shortName: "08031432", deviceLongName: "Sunset Park" }),
    ]);
    expect(plan.rows[0].needsRename).toBe(true);
  });

  it("leaves a properly named track alone", () => {
    const plan = buildSyncPlan([
      makeEntry({ status: "app_only", shortName: "OKC", trackName: "Orlando Kart Center", appTrack: appTrack([makeCourse()]) }),
    ]);
    expect(plan.rows[0].needsRename).toBe(false);
    expect(rowsNeedingRename(plan)).toEqual([]);
  });

  it("flags device-named courses", () => {
    const plan = buildSyncPlan([
      makeEntry({
        status: "device_only",
        appTrack: undefined,
        mergedCourses: courseEntries([
          ["N260803_1432", "device_only"],
          ["Full CW", "device_only"],
        ]),
      }),
    ]);
    expect(plan.rows[0].courses.map((c) => c.needsRename)).toEqual([true, false]);
  });
});

// ─── Rows that can never converge ────────────────────────────────────────────

describe("buildSyncPlan skips what can never converge", () => {
  // Each of these would report a difference on every single connect. Retrying
  // them forever is exactly the nag this whole flow exists to stop.
  it("skips a track holding both circuit and sprint courses", () => {
    const plan = buildSyncPlan([
      makeEntry({
        status: "app_only",
        appTrack: appTrack([makeCourse(), makeSprintCourse()]),
      }),
    ]);
    expect(plan.rows).toEqual([]);
    expect(plan.skipped[0].reason).toBe("mixed_kind");
  });

  it("skips a track with more courses than the firmware will read back", () => {
    const many = Array.from({ length: DEVICE_MAX_COURSES + 1 }, (_, i) =>
      makeCourse({ name: `C${i}` }),
    );
    const plan = buildSyncPlan([
      makeEntry({ status: "app_only", appTrack: appTrack(many), appCourses: many }),
    ]);
    expect(plan.rows).toEqual([]);
    expect(plan.skipped[0].reason).toBe("too_many_courses");
  });

  it("counts imported device courses toward that limit", () => {
    const nine = Array.from({ length: 9 }, (_, i) => makeCourse({ name: `C${i}` }));
    const entry = makeEntry({
      status: "mismatch",
      appTrack: appTrack(nine),
      appCourses: nine,
      mergedCourses: courseEntries([
        ["D1", "device_only"],
        ["D2", "device_only"],
      ]),
    });
    expect(buildSyncPlan([entry]).skipped[0].reason).toBe("too_many_courses");
  });

  it("allows a track exactly at the limit", () => {
    const ten = Array.from({ length: DEVICE_MAX_COURSES }, (_, i) => makeCourse({ name: `C${i}` }));
    const plan = buildSyncPlan([
      makeEntry({ status: "app_only", appTrack: appTrack(ten), appCourses: ten }),
    ]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.skipped).toEqual([]);
  });

  // The native IPC drops the `kind` argument, so a sprint write lands among the
  // circuit tracks. Better to say we can't than to corrupt the card.
  it("skips sprint tracks on a transport that can't reach the sprint folder", () => {
    const entry = makeEntry({
      status: "device_only",
      kind: "sprint",
      shortName: "SPR",
    });
    expect(buildSyncPlan([entry], { supportsSprintTracks: false }).skipped[0].reason).toBe(
      "sprint_unsupported",
    );
    expect(buildSyncPlan([entry], { supportsSprintTracks: true }).rows).toHaveLength(1);
  });

  it("defaults to assuming sprint is supported", () => {
    const entry = makeEntry({ status: "device_only", kind: "sprint", shortName: "SPR" });
    expect(buildSyncPlan([entry]).rows).toHaveLength(1);
  });

  it("never reports a synced track as skipped", () => {
    const plan = buildSyncPlan([
      makeEntry({ status: "synced", appTrack: appTrack([makeCourse(), makeSprintCourse()]) }),
    ]);
    expect(plan.skipped).toEqual([]);
  });
});

// ─── Keys ────────────────────────────────────────────────────────────────────

describe("buildSyncPlan keys", () => {
  // Circuit and sprint are separate files on the device, so the same shortName
  // in each is two different tracks and must not collide in the checkbox set.
  it("keys rows on (kind, shortName)", () => {
    const plan = buildSyncPlan([
      makeEntry({ status: "device_only", kind: "circuit", shortName: "OKC" }),
      makeEntry({ status: "device_only", kind: "sprint", shortName: "OKC" }),
    ]);
    expect(plan.rows.map((r) => r.key)).toEqual(["circuit:OKC", "sprint:OKC"]);
  });

  it("keys course rows under their track", () => {
    const plan = buildSyncPlan([
      makeEntry({
        status: "device_only",
        shortName: "OKC",
        mergedCourses: courseEntries([["Full CW", "device_only"]]),
      }),
    ]);
    expect(plan.rows[0].courses[0].key).toBe("circuit:OKC::Full CW");
  });
});
