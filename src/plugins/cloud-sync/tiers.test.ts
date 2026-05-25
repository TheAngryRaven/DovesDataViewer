import { describe, it, expect } from "vitest";
import {
  DEFAULT_LIMITS,
  docByteSize,
  formatBytes,
  isOverLimit,
  tierForStore,
  usageFraction,
  wouldExceed,
} from "./tiers";

describe("storage tiers", () => {
  it("classifies the files store as logs, everything else as documents", () => {
    expect(tierForStore("files")).toBe("logs");
    expect(tierForStore("setups")).toBe("documents");
    expect(tierForStore("karts")).toBe("documents");
    expect(tierForStore("graph-prefs")).toBe("documents");
  });

  it("has the agreed default limits (5 MB docs / 20 MB logs)", () => {
    expect(DEFAULT_LIMITS.documents).toBe(5 * 1024 * 1024);
    expect(DEFAULT_LIMITS.logs).toBe(20 * 1024 * 1024);
  });

  it("measures document byte size from serialized JSON", () => {
    expect(docByteSize({ a: 1 })).toBe(new TextEncoder().encode('{"a":1}').length);
    expect(docByteSize(null)).toBe(4); // "null"
  });

  it("computes a clamped usage fraction", () => {
    expect(usageFraction({ usedBytes: 0, limitBytes: 100 })).toBe(0);
    expect(usageFraction({ usedBytes: 50, limitBytes: 100 })).toBe(0.5);
    expect(usageFraction({ usedBytes: 200, limitBytes: 100 })).toBe(1);
    expect(usageFraction({ usedBytes: 5, limitBytes: 0 })).toBe(0);
  });

  it("detects over-limit and projected overflow", () => {
    expect(isOverLimit(101, 100)).toBe(true);
    expect(isOverLimit(100, 100)).toBe(false);
    expect(wouldExceed(90, 20, 100)).toBe(true);
    expect(wouldExceed(90, 10, 100)).toBe(false);
  });

  it("formats byte sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
