import { describe, it, expect } from "vitest";
import { dragToPose, normalizePose, pinchToPose, samePose, wrapYaw, FOV_MAX, FOV_MIN, PITCH_MAX } from "./pose";
import { DEFAULT_VIEW_POSE } from "./types";

describe("wrapYaw", () => {
  it("wraps into [-180, 180)", () => {
    expect(wrapYaw(0)).toBe(0);
    expect(wrapYaw(180)).toBe(-180);
    expect(wrapYaw(-180)).toBe(-180);
    expect(wrapYaw(190)).toBe(-170);
    expect(wrapYaw(-190)).toBe(170);
    expect(wrapYaw(720)).toBe(0);
  });
});

describe("normalizePose", () => {
  it("clamps pitch and fov, wraps yaw", () => {
    expect(normalizePose({ yaw: 370, pitch: 120, fov: 5 })).toEqual({ yaw: 10, pitch: PITCH_MAX, fov: FOV_MIN });
    expect(normalizePose({ yaw: -190, pitch: -120, fov: 900 })).toEqual({ yaw: 170, pitch: -PITCH_MAX, fov: FOV_MAX });
  });
  it("falls back to the default for non-finite parts", () => {
    expect(normalizePose({ yaw: NaN, pitch: Infinity, fov: -Infinity })).toEqual(DEFAULT_VIEW_POSE);
  });
  it("leaves an in-range pose alone", () => {
    const p = { yaw: -45.5, pitch: 10.25, fov: 75 };
    expect(normalizePose(p)).toEqual(p);
  });
});

describe("dragToPose", () => {
  const pose = { yaw: 0, pitch: 0, fov: 90 };
  it("a full-width drag sweeps the field of view, scene following the finger", () => {
    const p = dragToPose(pose, 1280, 0, 1280, 720);
    expect(p.yaw).toBeCloseTo(-90, 5);
    expect(p.pitch).toBe(0);
  });
  it("vertical drag uses the picture's aspect ratio", () => {
    const p = dragToPose(pose, 0, 720, 1280, 720);
    // vfov = 90 * 720/1280 = 50.625°, a full-height drag sweeps it.
    expect(p.pitch).toBeCloseTo(50.625, 5);
  });
  it("scales with the current fov (zoomed in = finer)", () => {
    const wide = dragToPose(pose, 100, 0, 1000, 500);
    const narrow = dragToPose({ ...pose, fov: 45 }, 100, 0, 1000, 500);
    expect(Math.abs(narrow.yaw)).toBeCloseTo(Math.abs(wide.yaw) / 2, 5);
  });
  it("wraps and clamps the result", () => {
    const p = dragToPose({ yaw: -170, pitch: 80, fov: 90 }, -400, 400, 1000, 500);
    expect(p.yaw).toBeCloseTo(-170 + 36 - 360 + 360, 5); // -134
    expect(p.pitch).toBe(PITCH_MAX);
  });
  it("ignores a degenerate picture size", () => {
    expect(dragToPose(pose, 50, 50, 0, 0)).toEqual(pose);
  });
});

describe("pinchToPose", () => {
  it("zooms in for scale > 1 and out for scale < 1, within limits", () => {
    expect(pinchToPose({ yaw: 0, pitch: 0, fov: 90 }, 2).fov).toBe(45);
    expect(pinchToPose({ yaw: 0, pitch: 0, fov: 90 }, 0.5).fov).toBe(FOV_MAX);
    expect(pinchToPose({ yaw: 0, pitch: 0, fov: 40 }, 10).fov).toBe(FOV_MIN);
  });
  it("ignores a bad scale", () => {
    const p = { yaw: 1, pitch: 2, fov: 60 };
    expect(pinchToPose(p, 0)).toEqual(p);
    expect(pinchToPose(p, NaN)).toEqual(p);
  });
});

describe("samePose", () => {
  it("treats yaw modulo 360 and sub-tenth-degree differences as equal", () => {
    expect(samePose({ yaw: 179.95, pitch: 0, fov: 90 }, { yaw: -180, pitch: 0.05, fov: 90.05 })).toBe(true);
    expect(samePose({ yaw: 0, pitch: 0, fov: 90 }, { yaw: 1, pitch: 0, fov: 90 })).toBe(false);
  });
});
