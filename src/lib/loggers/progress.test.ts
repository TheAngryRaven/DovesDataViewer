import { describe, it, expect, afterEach, vi } from "vitest";
import { formatBytes, formatSpeed, formatTime, computeProgress } from "./progress";

describe("formatBytes", () => {
  it("formats across unit boundaries", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1048576)).toBe("5.0 MB");
  });
});

describe("formatSpeed", () => {
  it("formats and guards against non-finite input", () => {
    expect(formatSpeed(500)).toBe("500 B/s");
    expect(formatSpeed(2048)).toBe("2.0 KB/s");
    expect(formatSpeed(NaN)).toBe("0 B/s");
    expect(formatSpeed(Infinity)).toBe("0 B/s");
  });
});

describe("formatTime", () => {
  it("formats seconds and minutes, guarding non-finite input", () => {
    expect(formatTime(12)).toBe("12s");
    expect(formatTime(90)).toBe("1m 30s");
    expect(formatTime(Infinity)).toBe("--");
  });
});

describe("computeProgress", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0% and an unknown ETA when total is unknown", () => {
    const p = computeProgress(0, 0, Date.now());
    expect(p.percent).toBe(0);
    expect(p.eta).toBe("--");
    expect(p.speed).toBe("0 B/s");
  });

  it("derives percent, speed and ETA from elapsed time", () => {
    vi.useFakeTimers();
    const start = 1_000_000;
    vi.setSystemTime(start);
    // 5 s later, half of 1000 bytes received → 500 B over 5 s = 100 B/s,
    // 500 bytes remaining at 100 B/s = 5 s ETA.
    vi.setSystemTime(start + 5000);
    const p = computeProgress(500, 1000, start);
    expect(p.received).toBe(500);
    expect(p.total).toBe(1000);
    expect(p.percent).toBe(50);
    expect(p.speed).toBe("100 B/s");
    expect(p.eta).toBe("5s");
  });

  it("reports 100% and no remaining time when complete", () => {
    vi.useFakeTimers();
    const start = 2_000_000;
    vi.setSystemTime(start + 2000);
    const p = computeProgress(1000, 1000, start);
    expect(p.percent).toBe(100);
    expect(p.eta).toBe("0s");
  });
});
