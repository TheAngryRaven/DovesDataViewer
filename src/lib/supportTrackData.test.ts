/**
 * Unit tests for the support track bundle (plan 0019).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Course, Track } from "@/types/racing";
import {
  buildSupportTrackBundle,
  supportTrackFileName,
  supportTrackBlob,
  collectSessionTrackAttachment,
  SUPPORT_TRACK_KIND,
  SUPPORT_TRACK_VERSION,
} from "./supportTrackData";

const line = (n: number) => ({ a: { lat: n, lon: n }, b: { lat: n + 1, lon: n + 1 } });

const legacyCourse: Course = {
  name: "Main",
  startFinishA: { lat: 1, lon: 1 },
  startFinishB: { lat: 1, lon: 2 },
  sector2: line(10),
  sector3: line(20),
};

const track: Track = { name: "Test Raceway", shortName: "TSTRWY", courses: [legacyCourse] };

// supportTrackData only imports getTrack. A hand-rolled stub (rather than
// vi.fn) keeps a rejecting implementation from being reported as an unhandled
// rejection by the mock-result tracking.
let getTrackCalls = 0;
let getTrackImpl: (name: string) => Promise<Track | undefined> = async () => undefined;
vi.mock("@/lib/trackStorage", () => ({
  getTrack: (name: string) => {
    getTrackCalls++;
    return getTrackImpl(name);
  },
}));

describe("buildSupportTrackBundle", () => {
  it("stamps the bundle so a future importer can recognise it", () => {
    const bundle = buildSupportTrackBundle({
      sessionFileName: "session_10-5788.csv",
      trackName: track.name,
      track,
      course: legacyCourse,
      appVersion: "4.0.1",
    })!;
    expect(bundle.kind).toBe(SUPPORT_TRACK_KIND);
    expect(bundle.version).toBe(SUPPORT_TRACK_VERSION);
    expect(bundle.sessionFile).toBe("session_10-5788.csv");
    expect(bundle.trackName).toBe("Test Raceway");
    expect(bundle.courseName).toBe("Main");
    expect(bundle.appVersion).toBe("4.0.1");
  });

  it("normalizes legacy sector2/sector3 into the canonical sector list", () => {
    const bundle = buildSupportTrackBundle({
      sessionFileName: "s.dove",
      trackName: track.name,
      track,
      course: legacyCourse,
    })!;
    expect(bundle.track.courses[0].sectors).toEqual([
      { line: line(10), major: true },
      { line: line(20), major: true },
    ]);
    expect(bundle.course?.sectors).toHaveLength(2);
  });

  it("carries the session's course even when it no longer matches the stored track", () => {
    const edited: Course = { ...legacyCourse, name: "Main", startFinishA: { lat: 9, lon: 9 } };
    const bundle = buildSupportTrackBundle({
      sessionFileName: "s.dove",
      trackName: track.name,
      track,
      course: edited,
    })!;
    // The discrepancy between the two is often the bug being reported.
    expect(bundle.course?.startFinishA).toEqual({ lat: 9, lon: 9 });
    expect(bundle.track.courses[0].startFinishA).toEqual({ lat: 1, lon: 1 });
  });

  it("still bundles the course when the track is gone from storage", () => {
    const bundle = buildSupportTrackBundle({
      sessionFileName: "s.dove",
      trackName: "Deleted Track",
      track: undefined,
      course: legacyCourse,
    })!;
    expect(bundle.track).toEqual({ name: "Deleted Track", courses: [] });
    expect(bundle.course?.name).toBe("Main");
  });

  it("returns null when there is nothing to send", () => {
    expect(
      buildSupportTrackBundle({ sessionFileName: "s.dove", trackName: "Nowhere", track: undefined }),
    ).toBeNull();
  });

  it("does not mutate the caller's track", () => {
    const before = JSON.stringify(track);
    buildSupportTrackBundle({ sessionFileName: "s.dove", trackName: track.name, track, course: legacyCourse });
    expect(JSON.stringify(track)).toBe(before);
  });
});

describe("supportTrackFileName", () => {
  it("pairs with the datalog name and swaps the extension", () => {
    expect(supportTrackFileName("session_10-5788.csv")).toBe("session_10-5788.track.json");
    expect(supportTrackFileName("run.dovex")).toBe("run.track.json");
  });

  it("sanitizes path separators and unsafe characters", () => {
    expect(supportTrackFileName("../../etc/pa$$wd.dove")).toBe("pa__wd.track.json");
  });
});

describe("supportTrackBlob", () => {
  it("serializes readable JSON", async () => {
    const bundle = buildSupportTrackBundle({
      sessionFileName: "s.dove",
      trackName: track.name,
      track,
      course: legacyCourse,
    })!;
    const parsed = JSON.parse(await supportTrackBlob(bundle).text());
    expect(parsed.kind).toBe(SUPPORT_TRACK_KIND);
    expect(parsed.track.name).toBe("Test Raceway");
  });
});

describe("collectSessionTrackAttachment", () => {
  beforeEach(() => {
    getTrackCalls = 0;
    getTrackImpl = async () => undefined;
  });

  it("reads the track from storage and names the attachment after the session", async () => {
    getTrackImpl = async () => track;
    const attachment = await collectSessionTrackAttachment({
      sessionFileName: "run.dovex",
      trackName: "Test Raceway",
      course: legacyCourse,
    });
    expect(attachment?.name).toBe("run.track.json");
    expect(JSON.parse(await attachment!.blob.text()).trackName).toBe("Test Raceway");
  });

  it("sends nothing for a session with no track (waypoint mode)", async () => {
    expect(await collectSessionTrackAttachment({ sessionFileName: "run.dovex", trackName: null })).toBeNull();
    expect(getTrackCalls).toBe(0);
  });

  it("survives a storage failure — the report still goes out with the log", async () => {
    getTrackImpl = () => Promise.reject(new Error("localStorage exploded"));
    const attachment = await collectSessionTrackAttachment({
      sessionFileName: "run.dovex",
      trackName: "Test Raceway",
      course: legacyCourse,
    });
    // No stored track, but the in-memory course is still worth sending.
    expect(attachment?.name).toBe("run.track.json");
    expect(JSON.parse(await attachment!.blob.text()).track.courses).toEqual([]);
  });
});
