import { describe, expect, it } from "vitest";
import type { FileEntry, FileMetadata } from "./fileStorage";
import type { Vehicle } from "./vehicleStorage";
import {
  buildBrowserSessions,
  computeBrowserView,
  defaultNav,
  filesTaggedWithCourse,
  formatSessionDisplayName,
  ROOT_NAV,
  UNTAGGED_TRACK,
  type BrowserSession,
} from "./fileBrowserTree";

// ── Helpers ──

function session(over: Partial<BrowserSession>): BrowserSession {
  return {
    fileName: over.fileName ?? "f",
    displayName: over.displayName ?? "name",
    savedAt: over.savedAt ?? 0,
    startTime: over.startTime,
    location: over.location ?? "local",
    size: over.size,
    trackName: over.trackName,
    courseName: over.courseName,
    engine: over.engine,
    kartId: over.kartId,
    kartName: over.kartName,
    fastestLapMs: over.fastestLapMs,
  };
}

describe("formatSessionDisplayName", () => {
  it("formats a start time as date + 12h time", () => {
    const t = new Date(2026, 1, 12, 11, 15).getTime(); // Feb 12 2026 11:15 local
    expect(formatSessionDisplayName(t, "raw.dove")).toBe("2/12/2026 11:15 AM");
  });

  it("handles midnight and noon", () => {
    expect(formatSessionDisplayName(new Date(2026, 0, 1, 0, 5).getTime(), "x")).toBe("1/1/2026 12:05 AM");
    expect(formatSessionDisplayName(new Date(2026, 0, 1, 12, 0).getTime(), "x")).toBe("1/1/2026 12:00 PM");
    expect(formatSessionDisplayName(new Date(2026, 0, 1, 23, 59).getTime(), "x")).toBe("1/1/2026 11:59 PM");
  });

  it("falls back to the file name with no start time", () => {
    expect(formatSessionDisplayName(undefined, "raw.dove")).toBe("raw.dove");
  });
});

describe("buildBrowserSessions", () => {
  const files: FileEntry[] = [
    { name: "a.dove", size: 1, savedAt: 100 },
    { name: "b.dove", size: 1, savedAt: 200 },
  ];
  const vehicles: Vehicle[] = [
    { id: "v1", name: "Kart 7", vehicleTypeId: "t", engine: "Rotax", number: 7, weight: 0, weightUnit: "lb" },
  ];

  it("resolves engine from the snapshot, then the live vehicle", () => {
    const metaMap = new Map<string, FileMetadata>([
      ["a.dove", { fileName: "a.dove", trackName: "OKC", courseName: "CW", sessionKartId: "v1", sessionStartTime: 1 }],
      ["b.dove", { fileName: "b.dove", trackName: "OKC", courseName: "CW", sessionKartId: "v1", sessionEngine: "IAME" }],
    ]);
    const [a, b] = buildBrowserSessions(files, metaMap, vehicles);
    expect(a.engine).toBe("Rotax");  // from live vehicle
    expect(a.kartName).toBe("Kart 7");
    expect(b.engine).toBe("IAME");   // frozen snapshot wins
  });

  it("leaves track/course/engine undefined when unset", () => {
    const [a] = buildBrowserSessions([files[0]], new Map(), vehicles);
    expect(a.trackName).toBeUndefined();
    expect(a.engine).toBeUndefined();
    expect(a.displayName).toBe("a.dove");
    expect(a.location).toBe("local");
    expect(a.size).toBe(1);
  });

  it("uses the metadata display-name override and carries the sample flag", () => {
    const metaMap = new Map<string, FileMetadata>([
      ["a.dove", {
        fileName: "a.dove", trackName: "OKC", courseName: "CW",
        sessionStartTime: new Date(2026, 1, 12, 11, 15).getTime(),
        displayName: "SAMPLE - Tillotson 225rs", isSample: true,
      }],
    ]);
    const [a] = buildBrowserSessions([files[0]], metaMap, vehicles);
    // Override wins over the date-derived name.
    expect(a.displayName).toBe("SAMPLE - Tillotson 225rs");
    expect(a.isSample).toBe(true);
  });

  it("defaults isSample to false for ordinary logs", () => {
    const metaMap = new Map<string, FileMetadata>([
      ["a.dove", { fileName: "a.dove", trackName: "OKC", courseName: "CW", sessionStartTime: 1 }],
    ]);
    const [a] = buildBrowserSessions([files[0]], metaMap, vehicles);
    expect(a.isSample).toBe(false);
  });

  it("merges remote (cloud) files as cloud sessions, deduped against local", () => {
    const metaMap = new Map<string, FileMetadata>([
      ["a.dove", { fileName: "a.dove", trackName: "OKC", courseName: "CW", sessionStartTime: 1 }],
      ["c.dove", { fileName: "c.dove", trackName: "OKC", courseName: "CW", sessionStartTime: 3 }],
    ]);
    const remote = [
      { name: "a.dove", size: 9, uploadedAt: "2026-01-01T00:00:00Z" }, // also local → ignored
      { name: "c.dove", size: 7, uploadedAt: "2026-01-02T00:00:00Z" }, // cloud-only
    ];
    const sessions = buildBrowserSessions(files, metaMap, vehicles, remote);
    expect(sessions.map((s) => s.fileName).sort()).toEqual(["a.dove", "b.dove", "c.dove"]);
    const a = sessions.find((s) => s.fileName === "a.dove")!;
    const c = sessions.find((s) => s.fileName === "c.dove")!;
    expect(a.location).toBe("local"); // local wins over the cloud copy
    expect(c.location).toBe("cloud");
    expect(c.size).toBe(7);
    expect(c.trackName).toBe("OKC"); // cloud-only file resolves its synced metadata
  });
});

describe("computeBrowserView — collapsing", () => {
  it("collapses a single track and single course straight to the log list", () => {
    const sessions = [
      session({ fileName: "1", trackName: "OKC", courseName: "CW", startTime: 2 }),
      session({ fileName: "2", trackName: "OKC", courseName: "CW", startTime: 1 }),
    ];
    const view = computeBrowserView(sessions, ROOT_NAV);
    expect(view.folders).toEqual([]);
    expect(view.sessions.map((s) => s.fileName)).toEqual(["1", "2"]); // newest first
    // Breadcrumb still records the collapsed track + course.
    expect(view.breadcrumb.map((b) => b.label)).toEqual(["All sessions", "OKC", "CW"]);
    expect(view.showFilter).toBe(true);
  });

  it("shows track folders when there is more than one track", () => {
    const sessions = [
      session({ fileName: "1", trackName: "OKC", courseName: "CW" }),
      session({ fileName: "2", trackName: "Daytona", courseName: "Nat" }),
    ];
    const view = computeBrowserView(sessions, ROOT_NAV);
    expect(view.folders.map((f) => f.label)).toEqual(["Daytona", "OKC"]); // alpha
    expect(view.folders.every((f) => f.kind === "track")).toBe(true);
    expect(view.sessions).toEqual([]);
  });

  it("shows course folders when a track has more than one course", () => {
    const sessions = [
      session({ fileName: "1", trackName: "OKC", courseName: "CW" }),
      session({ fileName: "2", trackName: "OKC", courseName: "CCW" }),
    ];
    const view = computeBrowserView(sessions, { track: "OKC", filter: "none" });
    expect(view.folders.map((f) => f.label)).toEqual(["CCW", "CW"]);
    expect(view.folders.every((f) => f.kind === "course")).toBe(true);
  });
});

describe("computeBrowserView — untagged bucket", () => {
  it("buckets untagged logs after real tracks", () => {
    const sessions = [
      session({ fileName: "1", trackName: "OKC", courseName: "CW" }),
      session({ fileName: "2" }), // untagged
    ];
    const view = computeBrowserView(sessions, ROOT_NAV);
    expect(view.folders.map((f) => f.label)).toEqual(["OKC", "Untagged"]);
    expect(view.folders[1].key).toBe(UNTAGGED_TRACK);
  });

  it("opens the untagged bucket straight to its logs (no course level)", () => {
    const sessions = [
      session({ fileName: "1", trackName: "OKC", courseName: "CW" }),
      session({ fileName: "2", startTime: 5 }),
      session({ fileName: "3", startTime: 9 }),
    ];
    const view = computeBrowserView(sessions, { track: UNTAGGED_TRACK, filter: "none" });
    expect(view.breadcrumb.map((b) => b.label)).toEqual(["All sessions", "Untagged"]);
    expect(view.sessions.map((s) => s.fileName)).toEqual(["3", "2"]);
  });

  it("collapses to a flat list when untagged is the only group", () => {
    const sessions = [session({ fileName: "1" }), session({ fileName: "2" })];
    const view = computeBrowserView(sessions, ROOT_NAV);
    expect(view.folders).toEqual([]);
    expect(view.sessions).toHaveLength(2);
    expect(view.breadcrumb.map((b) => b.label)).toEqual(["All sessions", "Untagged"]);
  });
});

describe("computeBrowserView — engine/kart filter", () => {
  const sessions = [
    session({ fileName: "1", trackName: "OKC", courseName: "CW", engine: "Rotax", kartId: "k1", kartName: "Kart 1" }),
    session({ fileName: "2", trackName: "OKC", courseName: "CW", engine: "IAME", kartId: "k2", kartName: "Kart 2" }),
    session({ fileName: "3", trackName: "OKC", courseName: "CW" }), // unconfigured
  ];

  it("builds a folder per engine with unconfigured logs below", () => {
    const view = computeBrowserView(sessions, { track: "OKC", course: "CW", filter: "engine" });
    expect(view.folders.map((f) => f.label)).toEqual(["IAME", "Rotax"]);
    expect(view.folders.every((f) => f.kind === "engine")).toBe(true);
    expect(view.sessions.map((s) => s.fileName)).toEqual(["3"]); // unconfigured loose
    expect(view.filterMode).toBe("engine");
  });

  it("always shows the folder even with a single engine group", () => {
    const single = [sessions[0], sessions[2]];
    const view = computeBrowserView(single, { track: "OKC", course: "CW", filter: "engine" });
    expect(view.folders.map((f) => f.label)).toEqual(["Rotax"]);
    expect(view.sessions.map((s) => s.fileName)).toEqual(["3"]);
  });

  it("drills into one engine folder and shows just its logs", () => {
    const view = computeBrowserView(sessions, {
      track: "OKC", course: "CW", filter: "engine", filterValue: "Rotax",
    });
    expect(view.folders).toEqual([]);
    expect(view.sessions.map((s) => s.fileName)).toEqual(["1"]);
    expect(view.breadcrumb.at(-1)?.label).toBe("Rotax");
  });

  it("labels kart folders by name but keys by id", () => {
    const view = computeBrowserView(sessions, { track: "OKC", course: "CW", filter: "kart" });
    expect(view.folders.map((f) => f.label)).toEqual(["Kart 1", "Kart 2"]);
    expect(view.folders.map((f) => f.key)).toEqual(["k1", "k2"]);
  });
});

describe("computeBrowserView — stale nav", () => {
  it("falls back to root when the track no longer exists", () => {
    const sessions = [
      session({ fileName: "1", trackName: "OKC", courseName: "CW" }),
      session({ fileName: "2", trackName: "Daytona", courseName: "Nat" }),
    ];
    const view = computeBrowserView(sessions, { track: "Ghost", filter: "none" });
    expect(view.folders.map((f) => f.label)).toEqual(["Daytona", "OKC"]);
  });
});

describe("defaultNav", () => {
  it("seeds from the current track/course", () => {
    expect(defaultNav("OKC", "CW")).toEqual({ track: "OKC", course: "CW", filter: "none" });
    expect(defaultNav("OKC", null)).toEqual({ track: "OKC", course: undefined, filter: "none" });
    expect(defaultNav(null, null)).toEqual(ROOT_NAV);
  });
});

describe("filesTaggedWithCourse", () => {
  function meta(over: Partial<FileMetadata>): FileMetadata {
    return {
      fileName: over.fileName ?? "f",
      trackName: over.trackName ?? "",
      courseName: over.courseName ?? "",
      sessionStartTime: over.sessionStartTime,
      fastestLapMs: over.fastestLapMs,
    };
  }

  const records = [
    meta({ fileName: "a", trackName: "OKC", courseName: "CW", sessionStartTime: 100, fastestLapMs: 60000 }),
    meta({ fileName: "b", trackName: "OKC", courseName: "CW", sessionStartTime: 300 }),
    meta({ fileName: "c", trackName: "OKC", courseName: "CCW", sessionStartTime: 200 }),
    meta({ fileName: "d", trackName: "Daytona", courseName: "CW", sessionStartTime: 400 }),
  ];

  it("returns only logs tagged with the course, newest first", () => {
    const result = filesTaggedWithCourse(records, "OKC", "CW");
    expect(result.map((r) => r.fileName)).toEqual(["b", "a"]);
    expect(result[1].fastestLapMs).toBe(60000);
  });

  it("labels each log by its session date/time", () => {
    const t = new Date(2026, 1, 12, 11, 15).getTime();
    const result = filesTaggedWithCourse([meta({ fileName: "x", trackName: "OKC", courseName: "CW", sessionStartTime: t })], "OKC", "CW");
    expect(result[0].displayName).toBe("2/12/2026 11:15 AM");
  });

  it("excludes the current file", () => {
    const result = filesTaggedWithCourse(records, "OKC", "CW", "b");
    expect(result.map((r) => r.fileName)).toEqual(["a"]);
  });

  it("matches the course across tracks when no track is given", () => {
    const result = filesTaggedWithCourse(records, undefined, "CW");
    expect(result.map((r) => r.fileName)).toEqual(["d", "b", "a"]);
  });

  it("returns nothing without a course", () => {
    expect(filesTaggedWithCourse(records, "OKC", undefined)).toEqual([]);
    expect(filesTaggedWithCourse(records, "OKC", "  ")).toEqual([]);
  });
});
