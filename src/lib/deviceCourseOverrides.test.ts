import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  clearCourseOverrides,
  isEmptyOverrides,
  loadTrackOverrides,
  loggerOverrideKey,
  parseCourseOverrides,
  saveTrackOverrides,
  trackOverrideKey,
} from "./deviceCourseOverrides";
import { NO_OVERRIDES, selectedDeviceCourses } from "./deviceCourseSelection";
import type { Course } from "@/types/racing";

const NOW = 1_800_000_000_000;

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

// ─── Keys ────────────────────────────────────────────────────────────────────

describe("loggerOverrideKey", () => {
  it("separates loggers, because they hold different cards", () => {
    expect(loggerOverrideKey("Logger-A")).not.toBe(loggerOverrideKey("Logger-B"));
  });

  it("still produces a key for an unnamed logger", () => {
    expect(loggerOverrideKey(null)).toBe("unknown");
    expect(loggerOverrideKey("")).toBe("unknown");
  });
});

describe("trackOverrideKey", () => {
  // A circuit and a sprint track are separate files in separate folders and may
  // legitimately share a short name.
  it("separates the two kinds under one short name", () => {
    expect(trackOverrideKey("circuit", "OKC")).not.toBe(trackOverrideKey("sprint", "OKC"));
  });
});

describe("isEmptyOverrides", () => {
  it("is true for no deviations", () => {
    expect(isEmptyOverrides(NO_OVERRIDES)).toBe(true);
  });

  it("is false once anything is overridden", () => {
    expect(isEmptyOverrides({ include: ["A"], exclude: [] })).toBe(false);
    expect(isEmptyOverrides({ include: [], exclude: ["A"] })).toBe(false);
  });
});

// ─── parseCourseOverrides ────────────────────────────────────────────────────

describe("parseCourseOverrides", () => {
  const good = {
    "Logger-A": { ts: NOW, tracks: { "sprint:OKC": { include: ["Old"], exclude: [] } } },
  };

  it("round-trips a well-formed store", () => {
    expect(parseCourseOverrides(JSON.stringify(good))).toEqual(good);
  });

  // Every failure mode has to land on "no overrides", because that means the
  // default rule applies — a working configuration rather than a broken one.
  it("returns nothing for null, junk, or the wrong shape", () => {
    expect(parseCourseOverrides(null)).toEqual({});
    expect(parseCourseOverrides("")).toEqual({});
    expect(parseCourseOverrides("not json")).toEqual({});
    expect(parseCourseOverrides("[1,2,3]")).toEqual({});
    expect(parseCourseOverrides("null")).toEqual({});
  });

  it("drops a logger entry with no usable timestamp", () => {
    const raw = JSON.stringify({ "Logger-A": { tracks: {} } });
    expect(parseCourseOverrides(raw)).toEqual({});
  });

  it("drops a track entry whose lists are not string arrays", () => {
    const raw = JSON.stringify({
      "Logger-A": {
        ts: NOW,
        tracks: {
          "sprint:OKC": { include: "Old", exclude: [] },
          "sprint:BAD": { include: [1, 2], exclude: [] },
          "sprint:OK": { include: ["Keep"], exclude: [] },
        },
      },
    });
    const out = parseCourseOverrides(raw);
    expect(Object.keys(out["Logger-A"].tracks)).toEqual(["sprint:OK"]);
  });

  it("keeps a logger whose tracks all turned out to be junk, with none of them", () => {
    const raw = JSON.stringify({
      "Logger-A": { ts: NOW, tracks: { "sprint:OKC": "nope" } },
    });
    expect(parseCourseOverrides(raw)).toEqual({ "Logger-A": { ts: NOW, tracks: {} } });
  });

  it("bounds a runaway logger list, keeping the most recently written", () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) {
      many[`Logger-${i}`] = { ts: NOW + i, tracks: {} };
    }
    const out = parseCourseOverrides(JSON.stringify(many));
    expect(Object.keys(out)).toHaveLength(20);
    expect(out["Logger-39"]).toBeDefined();
    expect(out["Logger-0"]).toBeUndefined();
  });
});

// ─── Round trip through storage ──────────────────────────────────────────────

describe("override round trip", () => {
  beforeEach(() => stubStorage());
  afterEach(() => vi.unstubAllGlobals());

  it("returns no overrides for a logger it has never seen", () => {
    expect(loadTrackOverrides("Logger-A", "sprint", "OKC")).toEqual(NO_OVERRIDES);
  });

  it("stores and reads back one track's overrides", () => {
    saveTrackOverrides("Logger-A", "sprint", "OKC", { include: ["Old"], exclude: [] });
    expect(loadTrackOverrides("Logger-A", "sprint", "OKC")).toEqual({
      include: ["Old"],
      exclude: [],
    });
  });

  it("keeps loggers apart", () => {
    saveTrackOverrides("Logger-A", "sprint", "OKC", { include: ["Old"], exclude: [] });
    expect(loadTrackOverrides("Logger-B", "sprint", "OKC")).toEqual(NO_OVERRIDES);
  });

  it("keeps the two track kinds apart", () => {
    saveTrackOverrides("Logger-A", "sprint", "OKC", { include: ["Old"], exclude: [] });
    expect(loadTrackOverrides("Logger-A", "circuit", "OKC")).toEqual(NO_OVERRIDES);
  });

  it("keeps several tracks on one logger", () => {
    saveTrackOverrides("Logger-A", "sprint", "OKC", { include: ["Old"], exclude: [] });
    saveTrackOverrides("Logger-A", "circuit", "TWS", { include: [], exclude: ["CCW"] });
    expect(loadTrackOverrides("Logger-A", "sprint", "OKC").include).toEqual(["Old"]);
    expect(loadTrackOverrides("Logger-A", "circuit", "TWS").exclude).toEqual(["CCW"]);
  });

  it("replaces an earlier entry rather than merging into it", () => {
    saveTrackOverrides("Logger-A", "sprint", "OKC", { include: ["Old"], exclude: [] });
    saveTrackOverrides("Logger-A", "sprint", "OKC", { include: ["Older"], exclude: [] });
    expect(loadTrackOverrides("Logger-A", "sprint", "OKC").include).toEqual(["Older"]);
  });

  // "Put it back the way it was" has to be representable, and a store full of
  // empty entries is just noise.
  it("removes the entry when the overrides become empty", () => {
    saveTrackOverrides("Logger-A", "sprint", "OKC", { include: ["Old"], exclude: [] });
    saveTrackOverrides("Logger-A", "sprint", "OKC", NO_OVERRIDES);
    expect(loadTrackOverrides("Logger-A", "sprint", "OKC")).toEqual(NO_OVERRIDES);
    expect(localStorage.getItem("dove-device-course-overrides")).toBe("{}");
  });

  it("does not store anything for a logger whose only track reverts to default", () => {
    saveTrackOverrides("Logger-A", "sprint", "OKC", NO_OVERRIDES);
    expect(localStorage.getItem("dove-device-course-overrides")).toBe("{}");
  });

  it("clears everything on request", () => {
    saveTrackOverrides("Logger-A", "sprint", "OKC", { include: ["Old"], exclude: [] });
    clearCourseOverrides();
    expect(loadTrackOverrides("Logger-A", "sprint", "OKC")).toEqual(NO_OVERRIDES);
  });

  it("does not alias the caller's arrays", () => {
    const overrides = { include: ["Old"], exclude: [] as string[] };
    saveTrackOverrides("Logger-A", "sprint", "OKC", overrides);
    overrides.include.push("Mutated");
    expect(loadTrackOverrides("Logger-A", "sprint", "OKC").include).toEqual(["Old"]);
  });

  it("degrades quietly when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    expect(() =>
      saveTrackOverrides("A", "sprint", "OKC", { include: ["x"], exclude: [] }),
    ).not.toThrow();
    expect(loadTrackOverrides("A", "sprint", "OKC")).toEqual(NO_OVERRIDES);
    expect(() => clearCourseOverrides()).not.toThrow();
  });
});

// ─── The property the whole design rests on ──────────────────────────────────

describe("an empty store is a working configuration", () => {
  beforeEach(() => stubStorage());
  afterEach(() => vi.unstubAllGlobals());

  function sprint(name: string, dateCreated: string): Course {
    return {
      name,
      type: "sprint",
      dateCreated,
      startFinishA: { lat: 35.4, lon: -97.3 },
      startFinishB: { lat: 35.4001, lon: -97.3001 },
      finish: { a: { lat: 35.41, lon: -97.31 }, b: { lat: 35.41, lon: -97.32 } },
      isUserDefined: true,
    };
  }

  // On a browser that has never seen this logger, the default rule alone must
  // produce a set the device can hold — otherwise the sync flow would prompt on
  // every connect, which is the trap plan 0016 closed.
  it("a never-seen logger still gets a single sprint course", () => {
    const courses = Array.from({ length: 25 }, (_, i) =>
      sprint(`Run ${i + 1}`, `2026-08-${String(i + 1).padStart(2, "0")}T09:00`),
    );
    const overrides = loadTrackOverrides("Brand-New-Browser", "sprint", "OKC");
    expect(overrides).toEqual(NO_OVERRIDES);
    expect(selectedDeviceCourses(courses, overrides)).toHaveLength(1);
  });
});
