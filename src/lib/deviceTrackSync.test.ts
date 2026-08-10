import { describe, it, expect, vi, afterEach } from "vitest";
import {
  coursesMatch,
  deviceCourseToAppCourse,
  appCourseToDeviceJson,
  buildTrackJsonForUpload,
  parseDeviceCourseJson,
  parseDeviceTrackFile,
  deviceTrackFileFrom,
  rebuildDeviceTrackJson,
  type DeviceTrackFileJson,
  buildMergedTrackList,
  countDeviceSectors,
  countAppSectors,
  startADistance,
  trackKind,
  isMixedKindTrack,
  type DeviceCourseJson,
  type DeviceTrackFile,
} from "./deviceTrackSync";
import type { Course, Track, SectorLine } from "@/types/racing";

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
  // This writer used to emit a bare array, and a test asserted that shape as the
  // contract. The firmware parses an array, but its array branch blanks
  // longName/shortName/defaultCourse and defaults every course to lengthFt 0 —
  // and lengthFt is what CourseDetector ranks by, so an array-uploaded track
  // could never be detected. The object form is what both the app's own track
  // files and the on-device course creator already write.
  it("emits the object form, not a bare array", () => {
    const track = makeAppTrack("OKC", [makeAppCourse()]);
    const parsed = JSON.parse(buildTrackJsonForUpload(track));
    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed.longName).toBe("Track-OKC");
    expect(parsed.shortName).toBe("OKC");
    expect(parsed.courses).toHaveLength(1);
    expect(parsed.courses[0].name).toBe("Full CW");
  });

  it("keeps lengthFt on the emitted courses (CourseDetector ranks by it)", () => {
    const track = makeAppTrack("OKC", [makeAppCourse({ lengthFt: 1500 })]);
    const parsed: DeviceTrackFileJson = JSON.parse(buildTrackJsonForUpload(track));
    expect(parsed.courses[0].lengthFt).toBe(1500);
  });

  it("marks the track type so the firmware's isSprint flag agrees with the folder", () => {
    const circuit = makeAppTrack("OKC", [makeAppCourse()]);
    const sprint = makeAppTrack("OKC", [
      makeAppCourse({
        type: "sprint",
        finish: { a: { lat: 35.41, lon: -97.31 }, b: { lat: 35.41, lon: -97.32 } },
      }),
    ]);
    expect(JSON.parse(buildTrackJsonForUpload(circuit)).type).toBe("circuit");
    expect(JSON.parse(buildTrackJsonForUpload(sprint)).type).toBe("sprint");
  });

  it("names the first course as the default", () => {
    const track = makeAppTrack("OKC", [
      makeAppCourse({ name: "A" }),
      makeAppCourse({ name: "B" }),
    ]);
    expect(JSON.parse(buildTrackJsonForUpload(track)).defaultCourse).toBe("A");
  });

  // An empty shortName reaches the DOVEX header's short_name column AND is the
  // key the next connect's merge looks the file up by, so it can never ship blank.
  it("derives a shortName when the app track has none", () => {
    const track: Track = { name: "Sunset Park", courses: [makeAppCourse()], isUserDefined: true };
    expect(JSON.parse(buildTrackJsonForUpload(track)).shortName).toBe("SP");
  });

  it("emits all courses in order", () => {
    const track = makeAppTrack("OKC", [
      makeAppCourse({ name: "A" }),
      makeAppCourse({ name: "B" }),
      makeAppCourse({ name: "C" }),
    ]);
    const parsed: DeviceTrackFileJson = JSON.parse(buildTrackJsonForUpload(track));
    expect(parsed.courses.map((c) => c.name)).toEqual(["A", "B", "C"]);
  });

  // Bytes are the constraint: the device parses a whole track file inside a
  // fixed buffer, and one byte past it takes the track out of detection
  // altogether. Indentation was about a quarter of the file.
  it("emits compact JSON, with no indentation to spend the budget on", () => {
    const json = buildTrackJsonForUpload(makeAppTrack("OKC", [makeAppCourse()]));
    expect(json).not.toContain("\t");
    expect(json).not.toContain("\n");
  });

  it("is meaningfully smaller than the indented form it replaced", () => {
    const track = makeAppTrack("OKC", [makeAppCourse(), makeAppCourse({ name: "B" })]);
    const compact = buildTrackJsonForUpload(track);
    const indented = JSON.stringify(JSON.parse(compact), null, "\t");
    expect(compact.length).toBeLessThan(indented.length * 0.85);
  });

  // The round trip that decides whether the sync wizard re-prompts forever.
  it("round-trips through parseDeviceTrackFile", () => {
    const track = makeAppTrack("OKC", [makeAppCourse()]);
    const back = parseDeviceTrackFile(buildTrackJsonForUpload(track));
    expect(back?.longName).toBe("Track-OKC");
    expect(back?.shortName).toBe("OKC");
    expect(back?.courses).toHaveLength(1);
  });
});

// ─── rebuildDeviceTrackJson ───────────────────────────────────────────────────

describe("rebuildDeviceTrackJson", () => {
  it("keeps the wrapper metadata when a single course is rewritten", () => {
    const entry = {
      deviceLongName: "Orlando Kart Center",
      trackName: "Orlando Kart Center",
      shortName: "OKC",
      kind: "circuit" as const,
    };
    const parsed: DeviceTrackFileJson = JSON.parse(
      rebuildDeviceTrackJson(entry, [makeDeviceCourse({ name: "B" })]),
    );
    expect(parsed.longName).toBe("Orlando Kart Center");
    expect(parsed.shortName).toBe("OKC");
    expect(parsed.type).toBe("circuit");
    expect(parsed.defaultCourse).toBe("B");
    expect(parsed.courses[0].lengthFt).toBe(1500);
  });

  it("falls back to the app track name, then the shortName, for longName", () => {
    const fromApp = JSON.parse(
      rebuildDeviceTrackJson({ trackName: "From App", shortName: "FA", kind: "circuit" }, []),
    );
    expect(fromApp.longName).toBe("From App");
    const bare = JSON.parse(rebuildDeviceTrackJson({ shortName: "FA", kind: "circuit" }, []));
    expect(bare.longName).toBe("FA");
  });
});

// ─── deviceTrackFileFrom ──────────────────────────────────────────────────────

describe("deviceTrackFileFrom", () => {
  afterEach(() => vi.restoreAllMocks());

  // The identity rule. A track the on-device course creator wrote is stored at
  // N260803_1432.json but declares shortName "08031432" — 8 chars, chosen by the
  // firmware precisely because that is this app's Track.shortName budget. Keying
  // the merge on the filename meant the imported track could never match the file
  // it came from, so the sync re-offered it on every connect forever.
  it("keys on the declared shortName, not the filename", () => {
    const raw = JSON.stringify({
      longName: "N260803_1432",
      shortName: "08031432",
      type: "sprint",
      courses: [makeDeviceCourse()],
    });
    const file = deviceTrackFileFrom("N260803_1432.json", raw, "sprint");
    expect(file.shortName).toBe("08031432");
    expect(file.fileName).toBe("N260803_1432.json");
    expect(file.longName).toBe("N260803_1432");
    expect(file.kind).toBe("sprint");
  });

  it("falls back to the filename base when the file declares no shortName", () => {
    const file = deviceTrackFileFrom("OKC.json", JSON.stringify([makeDeviceCourse()]), "circuit");
    expect(file.shortName).toBe("OKC");
    expect(file.fileName).toBe("OKC.json");
    expect(file.longName).toBeUndefined();
  });

  it("strips the extension case-insensitively", () => {
    expect(deviceTrackFileFrom("OKC.JSON", "[]", "circuit").shortName).toBe("OKC");
  });

  it("yields an empty course list for an unreadable file rather than throwing", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const file = deviceTrackFileFrom("BAD.json", "not json {", "circuit");
    expect(file.shortName).toBe("BAD");
    expect(file.courses).toEqual([]);
  });
});

// ─── round trip: does the sync settle? ────────────────────────────────────────

describe("device round trip", () => {
  // The load-bearing property of the whole sync flow: after a track has been
  // imported and pushed back, the next connect must see `synced`. Anything else
  // means the on-connect prompt re-fires forever.
  it("settles to 'synced' after an app track is uploaded and re-listed", () => {
    const track = makeAppTrack("OKC", [makeAppCourse()]);
    const onDevice = deviceTrackFileFrom(
      "OKC.json",
      buildTrackJsonForUpload(track),
      "circuit",
    );
    const merged = buildMergedTrackList([track], [onDevice]);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("synced");
  });

  // Curation reopens the same trap from a new direction: the device now holds a
  // SUBSET on purpose, and comparing against every app course would leave the
  // track at `mismatch` forever — prompting on every single connect.
  it("settles to 'synced' when a sprint track keeps only its newest course", () => {
    const sprintCourse = (name: string, dateCreated: string): Course =>
      makeAppCourse({
        name,
        type: "sprint",
        dateCreated,
        finish: { a: { lat: 35.41, lon: -97.31 }, b: { lat: 35.41, lon: -97.32 } },
      });

    const track: Track = {
      name: "Autocross Lot",
      shortName: "LOT",
      courses: [
        sprintCourse("Run Jan", "2026-01-04T09:00"),
        sprintCourse("Run Aug", "2026-08-09T14:32"),
      ],
      isUserDefined: true,
    };

    // The device carries only the newest, which is exactly what we upload.
    const onDevice = deviceTrackFileFrom(
      "LOT.json",
      buildTrackJsonForUpload({ ...track, courses: [track.courses[1]] }),
      "sprint",
    );

    const merged = buildMergedTrackList([track], [onDevice]);
    expect(merged[0].status).toBe("synced");
  });

  it("still reports a mismatch when the course that IS wanted is missing", () => {
    const sprintCourse = (name: string, dateCreated: string): Course =>
      makeAppCourse({
        name,
        type: "sprint",
        dateCreated,
        finish: { a: { lat: 35.41, lon: -97.31 }, b: { lat: 35.41, lon: -97.32 } },
      });

    const track: Track = {
      name: "Autocross Lot",
      shortName: "LOT",
      courses: [
        sprintCourse("Run Jan", "2026-01-04T09:00"),
        sprintCourse("Run Aug", "2026-08-09T14:32"),
      ],
      isUserDefined: true,
    };

    // The device has the OLD course; the newest one is the one that belongs.
    const onDevice = deviceTrackFileFrom(
      "LOT.json",
      buildTrackJsonForUpload({ ...track, courses: [track.courses[0]] }),
      "sprint",
    );

    expect(buildMergedTrackList([track], [onDevice])[0].status).toBe("mismatch");
  });

  it("settles when the user has explicitly kept an older sprint course too", () => {
    const sprintCourse = (name: string, dateCreated: string): Course =>
      makeAppCourse({
        name,
        type: "sprint",
        dateCreated,
        finish: { a: { lat: 35.41, lon: -97.31 }, b: { lat: 35.41, lon: -97.32 } },
      });

    const track: Track = {
      name: "Autocross Lot",
      shortName: "LOT",
      courses: [
        sprintCourse("Run Jan", "2026-01-04T09:00"),
        sprintCourse("Run Aug", "2026-08-09T14:32"),
      ],
      isUserDefined: true,
    };
    const onDevice = deviceTrackFileFrom(
      "LOT.json",
      buildTrackJsonForUpload(track),
      "sprint",
    );

    // Default rule alone: the device has one course too many.
    expect(buildMergedTrackList([track], [onDevice])[0].status).toBe("mismatch");

    // With the user's explicit include, both belong and it settles.
    const merged = buildMergedTrackList([track], [onDevice], () => ({
      include: ["Run Jan"],
      exclude: [],
    }));
    expect(merged[0].status).toBe("synced");
  });

  // The rename case: the file moves from N260803_1432.json to SUNSET.json, and
  // the app track carries name "Sunset Park" / shortName "SUNSET".
  it("settles to 'synced' after a device-authored track is renamed", () => {
    const renamed: Track = {
      name: "Sunset Park",
      shortName: "SUNSET",
      courses: [makeAppCourse({ name: "Sunset Park" })],
      isUserDefined: true,
    };
    const onDevice = deviceTrackFileFrom(
      "SUNSET.json",
      buildTrackJsonForUpload(renamed),
      "circuit",
    );
    const merged = buildMergedTrackList([renamed], [onDevice]);
    expect(merged[0].status).toBe("synced");
    expect(merged[0].deviceFileName).toBe("SUNSET.json");
  });

  // Before the identity split this was the nag: the app track (shortName from
  // the file) and the device file (keyed by filename) never met.
  it("matches a device-authored file to the track imported from it", () => {
    const deviceRaw = JSON.stringify({
      longName: "N260803_1432",
      shortName: "08031432",
      defaultCourse: "N260803_1432",
      courses: [makeDeviceCourse({ name: "N260803_1432" })],
    });
    const onDevice = deviceTrackFileFrom("N260803_1432.json", deviceRaw, "circuit");
    // What handleDownloadToApp now stores: longName as the name, the file's
    // DECLARED shortName as the key. Both are spelled out literally rather than
    // read back off `onDevice` — deriving them from the value under test made
    // this pass either way, which is exactly the bug it is meant to catch.
    const imported: Track = {
      name: "N260803_1432",
      shortName: "08031432",
      courses: onDevice.courses.map(deviceCourseToAppCourse),
      isUserDefined: true,
    };
    const merged = buildMergedTrackList([imported], [onDevice]);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("synced");
    // …and writes still go to the real file, not "08031432.json".
    expect(merged[0].deviceFileName).toBe("N260803_1432.json");
  });
});

// ─── parseDeviceTrackFile ─────────────────────────────────────────────────────

describe("parseDeviceTrackFile", () => {
  afterEach(() => vi.restoreAllMocks());

  // The metadata parseDeviceCourseJson drops. The rename flow needs longName to
  // show "what this track is currently called", and shortName because for a
  // device-authored file the FILENAME is the 12-char longName, not the 8-char
  // shortName the merge keys on.
  it("keeps the object wrapper's metadata", () => {
    const raw = JSON.stringify({
      longName: "N260804_1432",
      shortName: "08041432",
      type: "sprint",
      defaultCourse: "N260804_1432",
      courses: [makeDeviceCourse()],
    });
    const file = parseDeviceTrackFile(raw);
    expect(file).toEqual({
      longName: "N260804_1432",
      shortName: "08041432",
      type: "sprint",
      defaultCourse: "N260804_1432",
      courses: [makeDeviceCourse()],
    });
  });

  it("reports a bare array as courses with no metadata", () => {
    const file = parseDeviceTrackFile(JSON.stringify([makeDeviceCourse()]));
    expect(file?.courses).toHaveLength(1);
    expect(file?.longName).toBeUndefined();
    expect(file?.shortName).toBeUndefined();
  });

  it("treats empty-string metadata as absent", () => {
    const raw = JSON.stringify({ longName: "", shortName: "", courses: [] });
    const file = parseDeviceTrackFile(raw);
    expect(file?.longName).toBeUndefined();
    expect(file?.shortName).toBeUndefined();
  });

  it("returns null for malformed JSON without throwing", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseDeviceTrackFile("not json {")).toBeNull();
  });

  it("returns null for a JSON scalar", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseDeviceTrackFile("42")).toBeNull();
  });

  it("survives a non-array courses field", () => {
    const file = parseDeviceTrackFile(JSON.stringify({ longName: "X", courses: "nope" }));
    expect(file?.courses).toEqual([]);
    expect(file?.longName).toBe("X");
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

  // The device's own course creator writes the OBJECT format — the same shape
  // this app's track files use and that the firmware's parseTrackFile() reads.
  // Accepting only the bare array meant a walked course synced back as a track
  // with no courses in it, silently. An earlier test asserted exactly that
  // behaviour, which is how it survived: it pinned the bug as the contract.
  it("parses the object format the on-device course creator writes", () => {
    const raw = JSON.stringify({
      longName: "N260804_1432",
      shortName: "08041432",
      type: "sprint",
      defaultCourse: "N260804_1432",
      courses: [makeDeviceCourse()],
    });
    expect(parseDeviceCourseJson(raw)).toHaveLength(1);
  });

  it("keeps course order when the object holds several", () => {
    const raw = JSON.stringify({
      longName: "Venue",
      courses: [makeDeviceCourse({ name: "first" }), makeDeviceCourse({ name: "second" })],
    });
    expect(parseDeviceCourseJson(raw).map((c) => c.name)).toEqual(["first", "second"]);
  });

  it("returns [] for an object with an empty or missing course list", () => {
    expect(parseDeviceCourseJson('{"courses": []}')).toEqual([]);
    expect(parseDeviceCourseJson('{"longName":"Venue"}')).toEqual([]);
  });

  it("returns [] for a JSON scalar", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseDeviceCourseJson("42")).toEqual([]);
    expect(parseDeviceCourseJson("null")).toEqual([]);
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

// ─── Unlimited sectors: only the three majors reach the device ───────────────

describe("device export with sub-sectors", () => {
  const s2: SectorLine = { a: { lat: 35.4002, lon: -97.3002 }, b: { lat: 35.4003, lon: -97.3003 } };
  const s3: SectorLine = { a: { lat: 35.4004, lon: -97.3004 }, b: { lat: 35.4005, lon: -97.3005 } };
  const sub: SectorLine = { a: { lat: 35.4006, lon: -97.3006 }, b: { lat: 35.4007, lon: -97.3007 } };

  // Same course expressed legacy (sector2/3) vs new (sectors with extra sub-sector).
  const legacyCourse = makeAppCourse({ sector2: s2, sector3: s3 });
  const sectorCourse = makeAppCourse({
    sectors: [
      { line: sub, major: false }, // app-only sub-sector before the first major
      { line: s2, major: true },
      { line: s3, major: true },
    ],
  });

  it("exports byte-identical device JSON whether sub-sectors exist or not", () => {
    const legacyJson = appCourseToDeviceJson(legacyCourse);
    const withSubJson = appCourseToDeviceJson(sectorCourse);
    // The device only ever sees start/finish + the two majors.
    expect(withSubJson).toEqual(legacyJson);
    expect("sectors" in withSubJson).toBe(false);
    expect(withSubJson.sector_2_a_lat).toBe(s2.a.lat);
    expect(withSubJson.sector_3_a_lat).toBe(s3.a.lat);
  });

  it("treats a course with extra sub-sectors as synced against the device's two lines", () => {
    const dev = appCourseToDeviceJson(legacyCourse);
    // Adding an app-only sub-sector must NOT flag a mismatch.
    expect(coursesMatch(sectorCourse, dev)).toBe(true);
  });
});

// ─── Sprint courses (plan 0015) ──────────────────────────────────────────────

describe("sprint course wire format", () => {
  const finish: SectorLine = {
    a: { lat: 35.41000, lon: -97.31000 },
    b: { lat: 35.41010, lon: -97.31010 },
  };
  const split = (n: number): SectorLine => ({
    a: { lat: 35.405 + n / 1000, lon: -97.305 },
    b: { lat: 35.405 + n / 1000, lon: -97.304 },
  });

  const makeSprintCourse = (overrides: Partial<Course> = {}): Course =>
    makeAppCourse({ type: "sprint", finish, dateCreated: "2026-09-05T07:03", ...overrides });

  it("round-trips a bare sprint course through the device JSON", () => {
    const original = makeSprintCourse();
    const back = deviceCourseToAppCourse(appCourseToDeviceJson(original));

    expect(back.type).toBe("sprint");
    expect(back.finish).toEqual(finish);
    expect(back.dateCreated).toBe("2026-09-05T07:03");
    expect(back.startFinishA).toEqual(original.startFinishA);
    expect(back.startFinishB).toEqual(original.startFinishB);
  });

  it("round-trips split lines positionally, keeping them unflagged", () => {
    const original = makeSprintCourse({
      sectors: [{ line: split(1), major: false }, { line: split(2), major: false }],
    });
    const dc = appCourseToDeviceJson(original);

    // Splits ride in the device's existing sector_2/sector_3 slots.
    expect(dc.sector_2_a_lat).toBe(split(1).a.lat);
    expect(dc.sector_3_a_lat).toBe(split(2).a.lat);

    const back = deviceCourseToAppCourse(dc);
    expect(back.sectors).toHaveLength(2);
    expect(back.sectors!.map((s) => s.line)).toEqual([split(1), split(2)]);
    // `major` is meaningless point-to-point and must not be set — a course
    // retyped to circuit has to fail validation loudly, not look like a
    // three-major layout it never had.
    expect(back.sectors!.every((s) => !s.major)).toBe(true);
  });

  it("emits an unflagged single split, which legacyMirror would have dropped", () => {
    const dc = appCourseToDeviceJson(makeSprintCourse({
      sectors: [{ line: split(1), major: false }],
    }));
    expect(dc.sector_2_a_lat).toBe(split(1).a.lat);
    expect(dc.sector_3_a_lat).toBeUndefined();
  });

  it("emits no sprint fields for a circuit course", () => {
    const dc = appCourseToDeviceJson(makeAppCourse());
    expect(dc.finish_a_lat).toBeUndefined();
    expect(dc.date_created).toBeUndefined();
  });

  it("reads a device course with no finish line back as circuit", () => {
    const back = deviceCourseToAppCourse(makeDeviceCourse());
    expect(back.type).toBeUndefined();
    expect(back.finish).toBeUndefined();
  });

  it("matches an unchanged sprint course", () => {
    const course = makeSprintCourse();
    expect(coursesMatch(course, appCourseToDeviceJson(course))).toBe(true);
  });

  it("flags a moved finish line as a mismatch", () => {
    // The single most likely edit to a sprint course. Before the sprint branch
    // in coursesMatch this compared only start/finish and reported "synced".
    const course = makeSprintCourse();
    const dc = appCourseToDeviceJson(course);
    const moved = makeSprintCourse({
      finish: { a: { lat: 35.42000, lon: -97.32000 }, b: finish.b },
    });
    expect(coursesMatch(moved, dc)).toBe(false);
  });

  it("flags a changed date_created as a mismatch", () => {
    // It decides which course the device loads, so it is not cosmetic.
    const dc = appCourseToDeviceJson(makeSprintCourse());
    expect(coursesMatch(makeSprintCourse({ dateCreated: "2026-09-06T08:00" }), dc)).toBe(false);
  });

  it("flags a moved split as a mismatch", () => {
    const dc = appCourseToDeviceJson(makeSprintCourse({
      sectors: [{ line: split(1), major: false }],
    }));
    const moved = makeSprintCourse({ sectors: [{ line: split(5), major: false }] });
    expect(coursesMatch(moved, dc)).toBe(false);
  });

  it("never matches across a kind change, in either direction", () => {
    // The two kinds live in different folders on the device, so this is a
    // different file rather than an edit.
    const sprintJson = appCourseToDeviceJson(makeSprintCourse());
    const circuitJson = appCourseToDeviceJson(makeAppCourse());
    expect(coursesMatch(makeAppCourse(), sprintJson)).toBe(false);
    expect(coursesMatch(makeSprintCourse(), circuitJson)).toBe(false);
  });
});

// ─── Track kind + merge namespacing (plan 0015) ──────────────────────────────

describe("trackKind / isMixedKindTrack", () => {
  const sprintCourse = (name: string): Course => ({
    name,
    type: "sprint",
    startFinishA: { lat: 1, lon: 1 },
    startFinishB: { lat: 1, lon: 2 },
    finish: { a: { lat: 2, lon: 1 }, b: { lat: 2, lon: 2 } },
  });

  it("calls a track with no sprint courses circuit", () => {
    expect(trackKind({ courses: [makeAppCourse()] })).toBe("circuit");
  });

  it("calls a track with a sprint course sprint", () => {
    expect(trackKind({ courses: [sprintCourse("Run 1")] })).toBe("sprint");
  });

  it("treats an empty track as circuit", () => {
    expect(trackKind({ courses: [] })).toBe("circuit");
  });

  it("flags a track carrying both kinds", () => {
    // Unrepresentable on the device — the two kinds are separate files in
    // separate folders, so such a track would have to be split.
    expect(isMixedKindTrack({ courses: [makeAppCourse(), sprintCourse("Run 1")] })).toBe(true);
  });

  it("does not flag a single-kind track either way", () => {
    expect(isMixedKindTrack({ courses: [makeAppCourse()] })).toBe(false);
    expect(isMixedKindTrack({ courses: [sprintCourse("Run 1")] })).toBe(false);
    expect(isMixedKindTrack({ courses: [] })).toBe(false);
  });
});

describe("buildMergedTrackList — kind namespacing", () => {
  const sprintCourse = (name: string): Course => ({
    name,
    type: "sprint",
    startFinishA: { lat: 1, lon: 1 },
    startFinishB: { lat: 1, lon: 2 },
    finish: { a: { lat: 2, lon: 1 }, b: { lat: 2, lon: 2 } },
    dateCreated: "2026-09-05T07:03",
  });

  it("keeps a circuit and a sprint track with the SAME shortName separate", () => {
    // The device stores these as /TRACKS/OKC.json and /TRACKS/SPRINT/OKC.json —
    // two distinct files. Keying on shortName alone collided them and reported
    // one as a mismatch of the other.
    const appTracks: Track[] = [
      makeAppTrack("OKC", [makeAppCourse()]),
      { ...makeAppTrack("OKC", [sprintCourse("Run 1")]), name: "OKC Autocross" },
    ];
    const deviceFiles: DeviceTrackFile[] = [
      { shortName: "OKC", kind: "circuit", courses: [appCourseToDeviceJson(makeAppCourse())] },
      { shortName: "OKC", kind: "sprint", courses: [appCourseToDeviceJson(sprintCourse("Run 1"))] },
    ];

    const merged = buildMergedTrackList(appTracks, deviceFiles);
    expect(merged).toHaveLength(2);
    expect(merged.every((e) => e.status === "synced")).toBe(true);
    expect(merged.map((e) => e.kind).sort()).toEqual(["circuit", "sprint"]);
  });

  it("does not match an app sprint track against a circuit device file", () => {
    const appTracks = [{ ...makeAppTrack("OKC", [sprintCourse("Run 1")]) }];
    const deviceFiles: DeviceTrackFile[] = [
      { shortName: "OKC", kind: "circuit", courses: [appCourseToDeviceJson(makeAppCourse())] },
    ];
    const merged = buildMergedTrackList(appTracks, deviceFiles);
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.kind === "sprint")?.status).toBe("app_only");
    expect(merged.find((e) => e.kind === "circuit")?.status).toBe("device_only");
  });

  it("treats a device file with no kind as circuit, so old callers still match", () => {
    const appTracks = [makeAppTrack("OKC", [makeAppCourse()])];
    const deviceFiles: DeviceTrackFile[] = [
      { shortName: "OKC", courses: [appCourseToDeviceJson(makeAppCourse())] },
    ];
    const merged = buildMergedTrackList(appTracks, deviceFiles);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("synced");
    expect(merged[0].kind).toBe("circuit");
  });

  it("tags every entry with a kind", () => {
    const merged = buildMergedTrackList([makeAppTrack("OKC", [makeAppCourse()])], []);
    expect(merged[0].kind).toBe("circuit");
  });
});
