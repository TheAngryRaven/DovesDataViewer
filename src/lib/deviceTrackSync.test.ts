import { describe, it, expect, vi, afterEach } from "vitest";
import {
  coursesMatch,
  deviceCourseToAppCourse,
  appCourseToDeviceJson,
  buildTrackJsonForUpload,
  parseDeviceCourseJson,
  buildMergedTrackList,
  countDeviceSectors,
  countAppSectors,
  startADistance,
  type DeviceCourseJson,
  type DeviceTrackFile,
} from "./deviceTrackSync";
import type { Course, Track } from "@/types/racing";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeAppCourse(overrides: Partial<Course> = {}): Course {
  return {
    name: "Full CW",
    lengthFt: 1500,
    startFinishA: { lat: 35.40000, lon: -97.30000 },
    startFinishB: { lat: 35.40010, lon: -97.30010 },
    isUserDefined: true,
    ...overrides,
  };
}

function makeDeviceCourse(overrides: Partial<DeviceCourseJson> = {}): DeviceCourseJson {
  return {
    name: "Full CW",
    lengthFt: 1500,
    start_a_lat: 35.40000,
    start_a_lng: -97.30000,
    start_b_lat: 35.40010,
    start_b_lng: -97.30010,
    ...overrides,
  };
}

function makeAppTrack(shortName: string, courses: Course[]): Track {
  return { name: `Track-${shortName}`, shortName, courses, isUserDefined: false };
}

// ─── coursesMatch ─────────────────────────────────────────────────────────────

describe("coursesMatch", () => {
  it("returns true for exactly equal start/finish coords without sectors", () => {
    expect(coursesMatch(makeAppCourse(), makeDeviceCourse())).toBe(true);
  });

  it("returns true when coordinates differ by less than COORD_EPSILON (~0.05m)", () => {
    const app = makeAppCourse();
    const dev = makeDeviceCourse({ start_a_lat: 35.40000 + 1e-7 });
    expect(coursesMatch(app, dev)).toBe(true);
  });

  it("returns false when start_a_lat differs by more than epsilon", () => {
    const app = makeAppCourse();
    const dev = makeDeviceCourse({ start_a_lat: 35.40001 }); // 1m off — well past epsilon
    expect(coursesMatch(app, dev)).toBe(false);
  });

  it("returns false when any of the 4 start/finish coords differ", () => {
    expect(coursesMatch(makeAppCourse(), makeDeviceCourse({ start_a_lng: -97.5 }))).toBe(false);
    expect(coursesMatch(makeAppCourse(), makeDeviceCourse({ start_b_lat: 35.5 }))).toBe(false);
    expect(coursesMatch(makeAppCourse(), makeDeviceCourse({ start_b_lng: -97.5 }))).toBe(false);
  });

  it("returns false when app has sectors but device does not", () => {
    const app = makeAppCourse({
      sector2: { a: { lat: 35.41, lon: -97.31 }, b: { lat: 35.41, lon: -97.32 } },
      sector3: { a: { lat: 35.42, lon: -97.33 }, b: { lat: 35.42, lon: -97.34 } },
    });
    expect(coursesMatch(app, makeDeviceCourse())).toBe(false);
  });

  it("returns false when device has sectors but app does not", () => {
    const dev = makeDeviceCourse({
      sector_2_a_lat: 35.41, sector_2_a_lng: -97.31,
      sector_2_b_lat: 35.41, sector_2_b_lng: -97.32,
    });
    expect(coursesMatch(makeAppCourse(), dev)).toBe(false);
  });

  it("returns true when matching sector lines on both sides", () => {
    const app = makeAppCourse({
      sector2: { a: { lat: 35.41, lon: -97.31 }, b: { lat: 35.41, lon: -97.32 } },
      sector3: { a: { lat: 35.42, lon: -97.33 }, b: { lat: 35.42, lon: -97.34 } },
    });
    const dev = makeDeviceCourse({
      sector_2_a_lat: 35.41, sector_2_a_lng: -97.31,
      sector_2_b_lat: 35.41, sector_2_b_lng: -97.32,
      sector_3_a_lat: 35.42, sector_3_a_lng: -97.33,
      sector_3_b_lat: 35.42, sector_3_b_lng: -97.34,
    });
    expect(coursesMatch(app, dev)).toBe(true);
  });

  it("returns false when sector 2 coordinates drift past epsilon", () => {
    const app = makeAppCourse({
      sector2: { a: { lat: 35.41, lon: -97.31 }, b: { lat: 35.41, lon: -97.32 } },
      sector3: { a: { lat: 35.42, lon: -97.33 }, b: { lat: 35.42, lon: -97.34 } },
    });
    const dev = makeDeviceCourse({
      sector_2_a_lat: 35.41005, // ~5m off
      sector_2_a_lng: -97.31,
      sector_2_b_lat: 35.41, sector_2_b_lng: -97.32,
      sector_3_a_lat: 35.42, sector_3_a_lng: -97.33,
      sector_3_b_lat: 35.42, sector_3_b_lng: -97.34,
    });
    expect(coursesMatch(app, dev)).toBe(false);
  });

  it("does not consider name when comparing (matching is by geometry)", () => {
    const app = makeAppCourse({ name: "Alpha" });
    const dev = makeDeviceCourse({ name: "Beta" });
    expect(coursesMatch(app, dev)).toBe(true);
  });

  it("ignores lengthFt differences (lengthFt is descriptive, not a match key)", () => {
    const app = makeAppCourse({ lengthFt: 1500 });
    const dev = makeDeviceCourse({ lengthFt: 2000 });
    expect(coursesMatch(app, dev)).toBe(true);
  });
});

// ─── deviceCourseToAppCourse ──────────────────────────────────────────────────

describe("deviceCourseToAppCourse", () => {
  it("converts core start/finish fields", () => {
    const c = deviceCourseToAppCourse(makeDeviceCourse());
    expect(c.name).toBe("Full CW");
    expect(c.startFinishA).toEqual({ lat: 35.40000, lon: -97.30000 });
    expect(c.startFinishB).toEqual({ lat: 35.40010, lon: -97.30010 });
    expect(c.isUserDefined).toBe(true);
  });

  it("carries lengthFt through", () => {
    expect(deviceCourseToAppCourse(makeDeviceCourse({ lengthFt: 2200 })).lengthFt).toBe(2200);
  });

  it("attaches sector2 + sector3 only when BOTH are present", () => {
    const dev = makeDeviceCourse({
      sector_2_a_lat: 35.41, sector_2_a_lng: -97.31,
      sector_2_b_lat: 35.41, sector_2_b_lng: -97.32,
      sector_3_a_lat: 35.42, sector_3_a_lng: -97.33,
      sector_3_b_lat: 35.42, sector_3_b_lng: -97.34,
    });
    const c = deviceCourseToAppCourse(dev);
    expect(c.sector2).toEqual({ a: { lat: 35.41, lon: -97.31 }, b: { lat: 35.41, lon: -97.32 } });
    expect(c.sector3).toEqual({ a: { lat: 35.42, lon: -97.33 }, b: { lat: 35.42, lon: -97.34 } });
  });

  it("does NOT attach sector2 alone when sector3 is missing (treats as no-sectors)", () => {
    const dev = makeDeviceCourse({
      sector_2_a_lat: 35.41, sector_2_a_lng: -97.31,
      sector_2_b_lat: 35.41, sector_2_b_lng: -97.32,
      // sector_3_* fields absent
    });
    const c = deviceCourseToAppCourse(dev);
    expect(c.sector2).toBeUndefined();
    expect(c.sector3).toBeUndefined();
  });
});

// ─── appCourseToDeviceJson ────────────────────────────────────────────────────

describe("appCourseToDeviceJson", () => {
  it("converts core fields", () => {
    const dc = appCourseToDeviceJson(makeAppCourse());
    expect(dc.name).toBe("Full CW");
    expect(dc.start_a_lat).toBe(35.40000);
    expect(dc.start_a_lng).toBe(-97.30000);
    expect(dc.start_b_lat).toBe(35.40010);
    expect(dc.start_b_lng).toBe(-97.30010);
    expect(dc.lengthFt).toBe(1500);
  });

  it("omits lengthFt when the app course doesn't have one", () => {
    const dc = appCourseToDeviceJson(makeAppCourse({ lengthFt: undefined }));
    expect(dc.lengthFt).toBeUndefined();
    expect("lengthFt" in dc).toBe(false);
  });

  it("emits sector fields when present", () => {
    const dc = appCourseToDeviceJson(makeAppCourse({
      sector2: { a: { lat: 35.41, lon: -97.31 }, b: { lat: 35.41, lon: -97.32 } },
      sector3: { a: { lat: 35.42, lon: -97.33 }, b: { lat: 35.42, lon: -97.34 } },
    }));
    expect(dc.sector_2_a_lat).toBe(35.41);
    expect(dc.sector_2_a_lng).toBe(-97.31);
    expect(dc.sector_3_b_lng).toBe(-97.34);
  });

  it("round-trips with deviceCourseToAppCourse on courses with full sectors", () => {
    const original = makeAppCourse({
      sector2: { a: { lat: 35.41, lon: -97.31 }, b: { lat: 35.41, lon: -97.32 } },
      sector3: { a: { lat: 35.42, lon: -97.33 }, b: { lat: 35.42, lon: -97.34 } },
    });
    const roundTripped = deviceCourseToAppCourse(appCourseToDeviceJson(original));
    expect(roundTripped.name).toBe(original.name);
    expect(roundTripped.lengthFt).toBe(original.lengthFt);
    expect(roundTripped.startFinishA).toEqual(original.startFinishA);
    expect(roundTripped.startFinishB).toEqual(original.startFinishB);
    expect(roundTripped.sector2).toEqual(original.sector2);
    expect(roundTripped.sector3).toEqual(original.sector3);
  });
});

// ─── buildTrackJsonForUpload ──────────────────────────────────────────────────

describe("buildTrackJsonForUpload", () => {
  it("emits a JSON array of courses (not a wrapping object)", () => {
    const track = makeAppTrack("OKC", [makeAppCourse()]);
    const json = buildTrackJsonForUpload(track);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].name).toBe("Full CW");
  });

  it("emits all courses in order", () => {
    const track = makeAppTrack("OKC", [
      makeAppCourse({ name: "A" }),
      makeAppCourse({ name: "B" }),
      makeAppCourse({ name: "C" }),
    ]);
    const parsed: DeviceCourseJson[] = JSON.parse(buildTrackJsonForUpload(track));
    expect(parsed.map((c) => c.name)).toEqual(["A", "B", "C"]);
  });

  it("uses tab indentation (matches device expectation)", () => {
    const json = buildTrackJsonForUpload(makeAppTrack("OKC", [makeAppCourse()]));
    expect(json).toContain("\t");
  });
});

// ─── parseDeviceCourseJson ────────────────────────────────────────────────────

describe("parseDeviceCourseJson", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses a valid course array", () => {
    const raw = JSON.stringify([makeDeviceCourse()]);
    expect(parseDeviceCourseJson(raw)).toHaveLength(1);
  });

  it("returns [] for malformed JSON without throwing", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseDeviceCourseJson("not json {")).toEqual([]);
  });

  it("returns [] when JSON is valid but not an array (e.g. wrapping object)", () => {
    expect(parseDeviceCourseJson('{"courses": []}')).toEqual([]);
  });

  it("returns [] for empty array", () => {
    expect(parseDeviceCourseJson("[]")).toEqual([]);
  });
});

// ─── countDeviceSectors / countAppSectors ─────────────────────────────────────

describe("countDeviceSectors", () => {
  it("returns 0 when no sector fields are set", () => {
    expect(countDeviceSectors(makeDeviceCourse())).toBe(0);
  });

  it("returns 2 when only sector_2 fields are set", () => {
    expect(countDeviceSectors(makeDeviceCourse({
      sector_2_a_lat: 35.41, sector_2_a_lng: -97.31,
      sector_2_b_lat: 35.41, sector_2_b_lng: -97.32,
    }))).toBe(2);
  });

  it("returns 3 when both sector_2 and sector_3 fields are set", () => {
    expect(countDeviceSectors(makeDeviceCourse({
      sector_2_a_lat: 35.41, sector_2_a_lng: -97.31,
      sector_2_b_lat: 35.41, sector_2_b_lng: -97.32,
      sector_3_a_lat: 35.42, sector_3_a_lng: -97.33,
      sector_3_b_lat: 35.42, sector_3_b_lng: -97.34,
    }))).toBe(3);
  });
});

describe("countAppSectors", () => {
  it("returns 0 for a course with no sector lines", () => {
    expect(countAppSectors(makeAppCourse())).toBe(0);
  });

  it("returns 2 when only sector2 is set", () => {
    expect(countAppSectors(makeAppCourse({
      sector2: { a: { lat: 0, lon: 0 }, b: { lat: 0, lon: 0 } },
    }))).toBe(2);
  });

  it("returns 3 when both sector2 and sector3 are set", () => {
    expect(countAppSectors(makeAppCourse({
      sector2: { a: { lat: 0, lon: 0 }, b: { lat: 0, lon: 0 } },
      sector3: { a: { lat: 0, lon: 0 }, b: { lat: 0, lon: 0 } },
    }))).toBe(3);
  });
});

// ─── startADistance ───────────────────────────────────────────────────────────

describe("startADistance", () => {
  it("returns 0 for identical start_a points", () => {
    expect(startADistance(makeAppCourse(), makeDeviceCourse())).toBe(0);
  });

  it("returns ~111m for ~0.001° latitude difference", () => {
    const app = makeAppCourse();
    const dev = makeDeviceCourse({ start_a_lat: 35.401 }); // 0.001° = ~111m
    expect(startADistance(app, dev)).toBeCloseTo(111, 0);
  });
});

// ─── buildMergedTrackList ─────────────────────────────────────────────────────

describe("buildMergedTrackList", () => {
  it("returns [] for empty inputs", () => {
    expect(buildMergedTrackList([], [])).toEqual([]);
  });

  it("skips app tracks without shortName (cannot be matched to device)", () => {
    const trackNoShortName: Track = { name: "Anonymous", courses: [makeAppCourse()] };
    expect(buildMergedTrackList([trackNoShortName], [])).toEqual([]);
  });

  it("classifies a track present on both with matching courses as 'synced'", () => {
    const tracks = [makeAppTrack("OKC", [makeAppCourse()])];
    const deviceFiles: DeviceTrackFile[] = [{ shortName: "OKC", courses: [makeDeviceCourse()] }];
    const merged = buildMergedTrackList(tracks, deviceFiles);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("synced");
    expect(merged[0].mergedCourses[0].status).toBe("synced");
  });

  it("classifies a track with coord-drifting courses as 'mismatch'", () => {
    const tracks = [makeAppTrack("OKC", [makeAppCourse()])];
    const deviceFiles: DeviceTrackFile[] = [{
      shortName: "OKC",
      courses: [makeDeviceCourse({ start_a_lat: 35.5 })], // ~11km off
    }];
    const merged = buildMergedTrackList(tracks, deviceFiles);
    expect(merged[0].status).toBe("mismatch");
    expect(merged[0].mergedCourses[0].status).toBe("mismatch");
  });

  it("classifies an app track not on the device as 'app_only'", () => {
    const tracks = [makeAppTrack("OKC", [makeAppCourse()])];
    const merged = buildMergedTrackList(tracks, []);
    expect(merged[0].status).toBe("app_only");
    expect(merged[0].mergedCourses[0].status).toBe("app_only");
  });

  it("classifies a device track not in the app as 'device_only'", () => {
    const deviceFiles: DeviceTrackFile[] = [{ shortName: "UNKNOWN", courses: [makeDeviceCourse()] }];
    const merged = buildMergedTrackList([], deviceFiles);
    expect(merged[0].status).toBe("device_only");
    expect(merged[0].mergedCourses[0].status).toBe("device_only");
  });

  it("classifies per-course status correctly when some courses match and others don't", () => {
    const tracks = [makeAppTrack("OKC", [
      makeAppCourse({ name: "Full CW" }),
      makeAppCourse({ name: "Short" }),
      makeAppCourse({ name: "AppOnly" }),
    ])];
    const deviceFiles: DeviceTrackFile[] = [{
      shortName: "OKC",
      courses: [
        makeDeviceCourse({ name: "Full CW" }),                                  // synced
        makeDeviceCourse({ name: "Short", start_a_lat: 35.5 }),                 // mismatch
        makeDeviceCourse({ name: "DeviceOnly" }),                               // device_only
      ],
    }];
    const merged = buildMergedTrackList(tracks, deviceFiles);
    const statuses = new Map(merged[0].mergedCourses.map((c) => [c.name, c.status]));
    expect(statuses.get("Full CW")).toBe("synced");
    expect(statuses.get("Short")).toBe("mismatch");
    expect(statuses.get("AppOnly")).toBe("app_only");
    expect(statuses.get("DeviceOnly")).toBe("device_only");

    // Track-level status rolls up to mismatch when any course is non-synced
    expect(merged[0].status).toBe("mismatch");
  });

  it("sorts results: synced → mismatch → app_only → device_only", () => {
    const tracks = [
      makeAppTrack("AAA", [makeAppCourse()]),               // app_only
      makeAppTrack("BBB", [makeAppCourse()]),               // synced
      makeAppTrack("CCC", [makeAppCourse()]),               // mismatch
    ];
    const deviceFiles: DeviceTrackFile[] = [
      { shortName: "BBB", courses: [makeDeviceCourse()] },
      { shortName: "CCC", courses: [makeDeviceCourse({ start_a_lat: 35.5 })] },
      { shortName: "DDD", courses: [makeDeviceCourse()] }, // device_only
    ];
    const merged = buildMergedTrackList(tracks, deviceFiles);
    expect(merged.map((m) => m.status)).toEqual(["synced", "mismatch", "app_only", "device_only"]);
  });

  it("does not duplicate a device track that matches an app track", () => {
    const tracks = [makeAppTrack("OKC", [makeAppCourse()])];
    const deviceFiles: DeviceTrackFile[] = [{ shortName: "OKC", courses: [makeDeviceCourse()] }];
    const merged = buildMergedTrackList(tracks, deviceFiles);
    expect(merged).toHaveLength(1);
  });
});
