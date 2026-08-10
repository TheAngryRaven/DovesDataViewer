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

  // Curation shrinks what actually gets written, so the count guard has to
  // measure the planned set. Counting every app course skipped an eleven-course
  // sprint venue outright, when only one of them was ever going on the card.
  it("counts only the courses actually bound for the device", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => makeCourse({ name: `C${i}` }));
    const entry = makeEntry({
      status: "mismatch",
      appTrack: appTrack(eleven),
      appCourses: eleven,
      // Everything but the last is deliberately kept off the device.
      mergedCourses: eleven.map((c, i) => ({
        name: c.name,
        status: "app_only" as const,
        appCourse: c,
        plannedOnDevice: i === 10,
      })),
    });
    const plan = buildSyncPlan([entry]);
    expect(plan.skipped).toEqual([]);
    expect(plan.rows).toHaveLength(1);
  });

  it("still skips when the planned set alone is over the course limit", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => makeCourse({ name: `C${i}` }));
    const entry = makeEntry({
      status: "mismatch",
      appTrack: appTrack(eleven),
      appCourses: eleven,
      mergedCourses: eleven.map((c) => ({
        name: c.name,
        status: "app_only" as const,
        appCourse: c,
        plannedOnDevice: true,
      })),
    });
    expect(buildSyncPlan([entry]).skipped[0].reason).toBe("too_many_courses");
  });
});

// ─── The byte budget ─────────────────────────────────────────────────────────

describe("buildSyncPlan — track size", () => {
  /** A sprint course with a finish line and two splits: the heaviest shape. */
  function fatSprint(name: string): Course {
    return makeCourse({
      name,
      type: "sprint",
      dateCreated: "2026-08-09T14:32",
      finish: {
        a: { lat: 35.4198765, lon: -97.3198765 },
        b: { lat: 35.4199876, lon: -97.3199876 },
      },
      sectors: [
        {
          major: true,
          line: {
            a: { lat: 35.4150001, lon: -97.3150001 },
            b: { lat: 35.4151112, lon: -97.3151112 },
          },
        },
        {
          major: true,
          line: {
            a: { lat: 35.4170002, lon: -97.3170002 },
            b: { lat: 35.4171113, lon: -97.3171113 },
          },
        },
      ],
    });
  }

  function sprintEntry(count: number) {
    const courses = Array.from({ length: count }, (_, i) => fatSprint(`Run ${i + 1}`));
    return makeEntry({
      status: "app_only",
      kind: "sprint",
      appTrack: appTrack(courses),
      appCourses: courses,
      mergedCourses: courses.map((c) => ({
        name: c.name,
        status: "app_only" as const,
        appCourse: c,
        plannedOnDevice: true,
      })),
    });
  }

  // Nine of these fit the 10-course cap but not the smaller parse buffer. This
  // is the gap the count guard could never see, and it is the live bug: a sprint
  // track overflowed at about SEVEN courses.
  it("skips a track that fits the course cap but not the byte budget", () => {
    const plan = buildSyncPlan([sprintEntry(9)], { trackBudgetBytes: 4096 });
    expect(plan.skipped[0].reason).toBe("too_many_bytes");
  });

  it("accepts that same track on firmware with the larger buffer", () => {
    const plan = buildSyncPlan([sprintEntry(9)], { trackBudgetBytes: 8192 });
    expect(plan.skipped).toEqual([]);
    expect(plan.rows).toHaveLength(1);
  });

  // A caller that doesn't know the firmware must not invent a limit and start
  // skipping tracks that were fine before.
  it("does not check size at all when no budget is given", () => {
    const plan = buildSyncPlan([sprintEntry(9)]);
    expect(plan.skipped).toEqual([]);
  });

  it("accepts a small track well inside the budget", () => {
    const plan = buildSyncPlan([sprintEntry(1)], { trackBudgetBytes: 4096 });
    expect(plan.skipped).toEqual([]);
  });

  // Curation is what rescues the track: the same nine courses fit once only the
  // newest is bound for the card.
  it("fits once the older courses are kept off the device", () => {
    const courses = Array.from({ length: 9 }, (_, i) => fatSprint(`Run ${i + 1}`));
    const entry = makeEntry({
      status: "app_only",
      kind: "sprint",
      appTrack: appTrack(courses),
      appCourses: courses,
      mergedCourses: courses.map((c, i) => ({
        name: c.name,
        status: "app_only" as const,
        appCourse: c,
        plannedOnDevice: i === 8,
      })),
    });
    const plan = buildSyncPlan([entry], { trackBudgetBytes: 4096 });
    expect(plan.skipped).toEqual([]);
    expect(plan.rows).toHaveLength(1);
  });
});

describe("buildSyncPlan — transports", () => {
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
