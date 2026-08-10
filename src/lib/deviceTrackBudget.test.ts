import { describe, it, expect } from "vitest";
import {
  DEVICE_TRACK_BYTES_LARGE,
  DEVICE_TRACK_BYTES_SMALL,
  TRACK_BUFFER_MIN_VERSION,
  bytesOverBudget,
  deviceTrackBudget,
  fitsDeviceBudget,
  projectDeviceTrackBytes,
  supportsLargeTrackBuffer,
} from "./deviceTrackBudget";
import { buildTrackJsonForUpload } from "./deviceTrackSync";
import type { Course, Track } from "@/types/racing";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    name: "Full CW",
    startFinishA: { lat: 35.4123456, lon: -97.3123456 },
    startFinishB: { lat: 35.4124567, lon: -97.3124567 },
    isUserDefined: true,
    ...overrides,
  };
}

/** A sprint course carrying a finish line and two splits — the heaviest shape. */
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

function makeTrack(courses: Course[]): Track {
  return { name: "Orlando Kart Center", shortName: "OKC", courses, isUserDefined: true };
}

// ─── deviceTrackBudget ───────────────────────────────────────────────────────

describe("deviceTrackBudget", () => {
  it("gives the large buffer to firmware that has it", () => {
    expect(deviceTrackBudget(true)).toBe(DEVICE_TRACK_BYTES_LARGE);
  });

  it("gives the small buffer to firmware that does not", () => {
    expect(deviceTrackBudget(false)).toBe(DEVICE_TRACK_BYTES_SMALL);
  });

  // Guessing high overfills the card and takes the track out of detection at
  // the venue; guessing low costs the user one course they could have kept.
  // The asymmetry decides the default.
  it("assumes the small buffer when the capability is unknown", () => {
    expect(deviceTrackBudget(undefined)).toBe(DEVICE_TRACK_BYTES_SMALL);
  });

  it("the large buffer really is larger", () => {
    expect(DEVICE_TRACK_BYTES_LARGE).toBeGreaterThan(DEVICE_TRACK_BYTES_SMALL);
  });
});

// ─── supportsLargeTrackBuffer ────────────────────────────────────────────────

describe("supportsLargeTrackBuffer", () => {
  it("is true at and above the release that raised the buffer", () => {
    expect(supportsLargeTrackBuffer(TRACK_BUFFER_MIN_VERSION)).toBe(true);
    expect(supportsLargeTrackBuffer("3.2.1")).toBe(true);
    expect(supportsLargeTrackBuffer("4.0.0")).toBe(true);
  });

  it("is false below it", () => {
    expect(supportsLargeTrackBuffer("3.1.0")).toBe(false);
    expect(supportsLargeTrackBuffer("3.0.1")).toBe(false);
    expect(supportsLargeTrackBuffer("2.9.9")).toBe(false);
  });

  // A track file past the buffer isn't a degraded track — it fails to parse and
  // stops being detected at the venue. So not knowing has to mean "assume the
  // small buffer", which is the opposite of how needsOtaLayoutUpgrade treats an
  // unknown version.
  it("assumes the small buffer when the version is unknown", () => {
    expect(supportsLargeTrackBuffer(null)).toBe(false);
    expect(supportsLargeTrackBuffer(undefined)).toBe(false);
    expect(supportsLargeTrackBuffer("")).toBe(false);
  });

  // The beta channel stamps `<base>-beta.<gitsha>`, and compareVersions reads
  // the numeric core only. A beta of the capable release is capable.
  it("reads a beta build of a capable release as capable", () => {
    expect(supportsLargeTrackBuffer("3.2.0-beta.abc1234")).toBe(true);
  });

  it("reads a beta build of an older release as not capable", () => {
    expect(supportsLargeTrackBuffer("3.1.0-beta.abc1234")).toBe(false);
  });

  it("feeds the budget directly", () => {
    expect(deviceTrackBudget(supportsLargeTrackBuffer("3.2.0"))).toBe(DEVICE_TRACK_BYTES_LARGE);
    expect(deviceTrackBudget(supportsLargeTrackBuffer("3.1.0"))).toBe(DEVICE_TRACK_BYTES_SMALL);
  });
});

// ─── projectDeviceTrackBytes ─────────────────────────────────────────────────

describe("projectDeviceTrackBytes", () => {
  // The whole point of the module: the number shown to the user as the reason
  // they must drop a course has to be the number the device is handed.
  it("equals the encoded length of what the upload writer emits", () => {
    const track = makeTrack([makeCourse(), makeCourse({ name: "CCW" })]);
    const written = new TextEncoder().encode(buildTrackJsonForUpload(track)).length;
    expect(projectDeviceTrackBytes(track, track.courses)).toBe(written);
  });

  it("measures the courses it is given, not the ones on the track", () => {
    const all = [makeCourse({ name: "A" }), makeCourse({ name: "B" }), makeCourse({ name: "C" })];
    const track = makeTrack(all);
    const one = projectDeviceTrackBytes(track, [all[0]]);
    const three = projectDeviceTrackBytes(track, all);
    expect(one).toBeLessThan(three);
  });

  it("does not mutate the track it was handed", () => {
    const track = makeTrack([makeCourse({ name: "A" }), makeCourse({ name: "B" })]);
    projectDeviceTrackBytes(track, [track.courses[0]]);
    expect(track.courses).toHaveLength(2);
  });

  it("handles a track with no courses at all", () => {
    const track = makeTrack([]);
    expect(projectDeviceTrackBytes(track, [])).toBeGreaterThan(0);
  });

  it("counts bytes rather than characters for non-ASCII names", () => {
    const ascii = makeTrack([makeCourse({ name: "Circuit" })]);
    const accented = makeTrack([makeCourse({ name: "Cïrcüït" })]);
    expect(projectDeviceTrackBytes(accented, accented.courses)).toBeGreaterThan(
      projectDeviceTrackBytes(ascii, ascii.courses),
    );
  });

  // Sanity-check against the firmware's own measurements: it put a sprint
  // course with a finish and two splits at ~528 B in the shape its writer
  // emits. If this drifts far, the app's writer and the device's reader have
  // diverged and the projection is measuring the wrong thing.
  it("lands in the right order of magnitude per sprint course", () => {
    const track = makeTrack([fatSprint("Run 1"), fatSprint("Run 2")]);
    const one = projectDeviceTrackBytes(track, [track.courses[0]]);
    const two = projectDeviceTrackBytes(track, track.courses);
    const perCourse = two - one;
    expect(perCourse).toBeGreaterThan(200);
    expect(perCourse).toBeLessThan(900);
  });

  // The failure this plan exists to prevent: enough dated sprint courses and
  // the file no longer fits the smaller buffer.
  it("shows a season of sprint courses overflowing the small buffer", () => {
    const courses = Array.from({ length: 20 }, (_, i) => fatSprint(`Run ${i + 1}`));
    const track = makeTrack(courses);
    expect(projectDeviceTrackBytes(track, courses)).toBeGreaterThan(DEVICE_TRACK_BYTES_SMALL);
  });
});

// ─── fitsDeviceBudget / bytesOverBudget ──────────────────────────────────────

describe("fitsDeviceBudget", () => {
  it("accepts a small track", () => {
    const track = makeTrack([makeCourse()]);
    expect(fitsDeviceBudget(track, track.courses, DEVICE_TRACK_BYTES_SMALL)).toBe(true);
  });

  it("rejects a track past the budget", () => {
    const courses = Array.from({ length: 20 }, (_, i) => fatSprint(`Run ${i + 1}`));
    const track = makeTrack(courses);
    expect(fitsDeviceBudget(track, courses, DEVICE_TRACK_BYTES_SMALL)).toBe(false);
  });

  it("treats exactly the budget as fitting", () => {
    const track = makeTrack([makeCourse()]);
    const exact = projectDeviceTrackBytes(track, track.courses);
    expect(fitsDeviceBudget(track, track.courses, exact)).toBe(true);
    expect(fitsDeviceBudget(track, track.courses, exact - 1)).toBe(false);
  });

  it("a track too big for the small buffer can still fit the large one", () => {
    const courses = Array.from({ length: 9 }, (_, i) => fatSprint(`Run ${i + 1}`));
    const track = makeTrack(courses);
    expect(fitsDeviceBudget(track, courses, DEVICE_TRACK_BYTES_SMALL)).toBe(false);
    expect(fitsDeviceBudget(track, courses, DEVICE_TRACK_BYTES_LARGE)).toBe(true);
  });
});

describe("bytesOverBudget", () => {
  it("is 0 when the track fits", () => {
    const track = makeTrack([makeCourse()]);
    expect(bytesOverBudget(track, track.courses, DEVICE_TRACK_BYTES_SMALL)).toBe(0);
  });

  it("reports the overshoot when it does not", () => {
    const courses = Array.from({ length: 20 }, (_, i) => fatSprint(`Run ${i + 1}`));
    const track = makeTrack(courses);
    const over = bytesOverBudget(track, courses, DEVICE_TRACK_BYTES_SMALL);
    expect(over).toBe(projectDeviceTrackBytes(track, courses) - DEVICE_TRACK_BYTES_SMALL);
    expect(over).toBeGreaterThan(0);
  });
});
