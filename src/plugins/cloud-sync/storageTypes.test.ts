import { describe, it, expect } from "vitest";
import {
  DEFAULT_TOTAL_LIMIT,
  formatBytes,
  segmentFractions,
  storageTypeForStore,
  totalUsed,
  usageFraction,
  type StorageUsage,
} from "./storageTypes";

describe("storage types (single pool)", () => {
  it("classifies the files store as logs, everything else as documents", () => {
    expect(storageTypeForStore("files")).toBe("logs");
    expect(storageTypeForStore("setups")).toBe("documents");
    expect(storageTypeForStore("karts")).toBe("documents");
    expect(storageTypeForStore("graph-prefs")).toBe("documents");
  });

  it("uses the free 50 MB budget as the advisory fallback", () => {
    expect(DEFAULT_TOTAL_LIMIT).toBe(50 * 1024 * 1024);
  });

  it("sums the three segments", () => {
    expect(totalUsed({ documents: 1, logs: 2, snapshots: 3 })).toBe(6);
  });

  it("computes a clamped usage fraction", () => {
    expect(usageFraction(0, 100)).toBe(0);
    expect(usageFraction(50, 100)).toBe(0.5);
    expect(usageFraction(200, 100)).toBe(1); // clamped
    expect(usageFraction(5, 0)).toBe(0); // no limit
  });

  it("formats byte sizes up to GB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50.0 MB");
    expect(formatBytes(10 * 1024 * 1024 * 1024)).toBe("10.0 GB");
    expect(formatBytes(100 * 1024 * 1024 * 1024)).toBe("100.0 GB");
    expect(formatBytes(500 * 1024 * 1024 * 1024)).toBe("500.0 GB");
  });

  it("rolls over at unit boundaries instead of showing 1024 KB / 1024.0 MB", () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe("1.0 MB"); // not "1024 KB"
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1024 - 1)).toBe("1.0 GB"); // not "1024.0 MB"
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  describe("segmentFractions", () => {
    it("leaves empty space when under the limit", () => {
      const u: StorageUsage = { documents: 10, logs: 20, snapshots: 30, totalLimit: 100 };
      const f = segmentFractions(u);
      expect(f.documents).toBeCloseTo(0.1);
      expect(f.logs).toBeCloseTo(0.2);
      expect(f.snapshots).toBeCloseTo(0.3);
      expect(f.documents + f.logs + f.snapshots).toBeCloseTo(0.6); // 0.4 left empty
    });

    it("fills the whole bar exactly at the limit", () => {
      const u: StorageUsage = { documents: 50, logs: 30, snapshots: 20, totalLimit: 100 };
      const f = segmentFractions(u);
      expect(f.documents + f.logs + f.snapshots).toBeCloseTo(1);
    });

    it("normalises to a full bar (keeping proportions) when over the limit", () => {
      const u: StorageUsage = { documents: 40, logs: 40, snapshots: 40, totalLimit: 100 };
      const f = segmentFractions(u);
      // 1.2 raw → each scaled to 0.4/1.2 ≈ 1/3, summing to 1 (full, no empty space).
      expect(f.documents).toBeCloseTo(1 / 3);
      expect(f.logs).toBeCloseTo(1 / 3);
      expect(f.snapshots).toBeCloseTo(1 / 3);
      expect(f.documents + f.logs + f.snapshots).toBeCloseTo(1);
    });

    it("clamps negatives and guards a zero limit", () => {
      const u: StorageUsage = { documents: -5, logs: 0, snapshots: 0, totalLimit: 0 };
      const f = segmentFractions(u);
      expect(f.documents).toBe(0);
      expect(f.logs).toBe(0);
      expect(f.snapshots).toBe(0);
    });
  });
});
