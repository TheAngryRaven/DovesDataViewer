import { describe, it, expect } from "vitest";
import { PlayerClock } from "./playerClock";

describe("PlayerClock", () => {
  it("holds the last report while paused", () => {
    const c = new PlayerClock();
    c.report({ positionMs: 5000, durationMs: 60000, playing: false }, 1000);
    expect(c.positionAt(9000)).toBe(5000);
    expect(c.duration).toBe(60000);
    expect(c.isPlaying).toBe(false);
  });

  it("extrapolates while playing and clamps at the duration", () => {
    const c = new PlayerClock();
    c.report({ positionMs: 5000, durationMs: 6000, playing: true }, 1000);
    expect(c.positionAt(1500)).toBe(5500);
    expect(c.positionAt(9000)).toBe(6000);
  });

  it("never runs backwards on a stale clock", () => {
    const c = new PlayerClock();
    c.report({ positionMs: 5000, durationMs: 60000, playing: true }, 1000);
    expect(c.positionAt(500)).toBe(5000);
  });

  it("snaps on seek and keeps a zero duration open-ended", () => {
    const c = new PlayerClock();
    c.report({ positionMs: 0, durationMs: 0, playing: true }, 0);
    c.seek(20000, 100);
    expect(c.positionAt(1100)).toBe(21000);
    c.setDuration(20500);
    expect(c.positionAt(2100)).toBe(20500);
    c.seek(-5, 3000);
    expect(c.positionAt(3000)).toBe(0);
  });

  it("freezes the extrapolated position when pausing", () => {
    const c = new PlayerClock();
    c.report({ positionMs: 1000, durationMs: 60000, playing: true }, 0);
    c.setPlaying(false, 700);
    expect(c.positionAt(5000)).toBe(1700);
    c.setPlaying(true, 6000);
    expect(c.positionAt(6250)).toBe(1950);
  });

  it("ignores a zero duration in a report but accepts a real one later", () => {
    const c = new PlayerClock();
    c.report({ positionMs: 10, durationMs: 0, playing: false }, 0);
    expect(c.duration).toBe(0);
    c.report({ positionMs: 10, durationMs: 42, playing: false }, 1);
    expect(c.duration).toBe(42);
    c.report({ positionMs: 12, durationMs: 0, playing: false }, 2);
    expect(c.duration).toBe(42);
  });
});
