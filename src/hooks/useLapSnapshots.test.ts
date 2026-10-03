import { describe, expect, it } from "vitest";
import { snapshotEligible } from "./useLapSnapshots";

describe("snapshotEligible", () => {
  const base = { hasCourse: true, lapCount: 3, engine: "KA100", isDragSession: false };

  it("allows a course session with laps and an engine", () => {
    expect(snapshotEligible(base)).toBe(true);
  });

  it("refuses without a course, laps, or engine", () => {
    expect(snapshotEligible({ ...base, hasCourse: false })).toBe(false);
    expect(snapshotEligible({ ...base, lapCount: 0 })).toBe(false);
    expect(snapshotEligible({ ...base, engine: "" })).toBe(false);
  });

  it("refuses a drag session even when a stale course selection survived (plan 0022)", () => {
    expect(snapshotEligible({ ...base, isDragSession: true })).toBe(false);
  });
});
