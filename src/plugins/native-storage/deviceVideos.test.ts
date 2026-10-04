import { describe, it, expect } from "vitest";
import type { NativeStoredVideoEntry } from "@/lib/nativeVideoStore";
import {
  formatVideoBytes,
  sessionLabel,
  sortDeviceVideos,
  totalDeviceVideoBytes,
  withoutRemoved,
} from "./deviceVideos";

const entry = (over: Partial<NativeStoredVideoEntry>): NativeStoredVideoEntry => ({
  key: "k",
  fileName: "f.mp4",
  size: 0,
  path: "/x",
  ...over,
});

describe("formatVideoBytes", () => {
  it("scales through B, KB, MB and GB", () => {
    expect(formatVideoBytes(0)).toBe("0 B");
    expect(formatVideoBytes(1023)).toBe("1023 B");
    expect(formatVideoBytes(1536)).toBe("2 KB");
    expect(formatVideoBytes(5.25 * 1024 * 1024)).toBe("5.3 MB");
    expect(formatVideoBytes(512 * 1024 * 1024)).toBe("512 MB");
    expect(formatVideoBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.50 GB");
  });
});

describe("sortDeviceVideos", () => {
  it("puts the newest first and undated legacy copies last, by name", () => {
    const sorted = sortDeviceVideos([
      entry({ key: "b", fileName: "b.mp4" }),
      entry({ key: "old", fileName: "old.mp4", storedAtMs: 1_000 }),
      entry({ key: "a", fileName: "a.mp4" }),
      entry({ key: "new", fileName: "new.mp4", storedAtMs: 2_000 }),
    ]);
    expect(sorted.map((e) => e.key)).toEqual(["new", "old", "a", "b"]);
  });

  it("does not mutate its input", () => {
    const input = [entry({ key: "x", storedAtMs: 1 }), entry({ key: "y", storedAtMs: 2 })];
    sortDeviceVideos(input);
    expect(input.map((e) => e.key)).toEqual(["x", "y"]);
  });
});

describe("totalDeviceVideoBytes", () => {
  it("sums sizes", () => {
    expect(totalDeviceVideoBytes([])).toBe(0);
    expect(totalDeviceVideoBytes([entry({ size: 10 }), entry({ size: 32 })])).toBe(42);
  });
});

describe("sessionLabel", () => {
  it("drops the session file's extension", () => {
    expect(sessionLabel(entry({ sessionFileName: "2026-08-30 Session.dovex" }))).toBe("2026-08-30 Session");
    expect(sessionLabel(entry({ sessionFileName: "v1.2 run.csv" }))).toBe("v1.2 run");
    expect(sessionLabel(entry({ sessionFileName: "noext" }))).toBe("noext");
  });

  it("is null for copies stored before the shell recorded the session", () => {
    expect(sessionLabel(entry({}))).toBeNull();
    expect(sessionLabel(entry({ sessionFileName: "  " }))).toBeNull();
  });
});

describe("withoutRemoved", () => {
  const listing = [entry({ key: "a" }), entry({ key: "b" }), entry({ key: "c" })];

  it("drops the removed keys", () => {
    expect(withoutRemoved(listing, ["b"]).map((e) => e.key)).toEqual(["a", "c"]);
    expect(withoutRemoved(listing, ["zzz"]).map((e) => e.key)).toEqual(["a", "b", "c"]);
  });

  it("empties the listing on a clear", () => {
    expect(withoutRemoved(listing, null)).toEqual([]);
  });
});
