import { describe, it, expect } from "vitest";
import { resampleToCount, computeRigidTransform, alignLapToReference } from "./lapAlignment";
import type { GpsSample } from "@/types/racing";

describe("resampleToCount", () => {
  it("evenly resamples a straight segment by arc length", () => {
    const out = resampleToCount([{ x: 0, y: 0 }, { x: 10, y: 0 }], 3);
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]);
  });

  it("keeps endpoints and returns the requested count", () => {
    const out = resampleToCount([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], 5);
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[4]).toEqual({ x: 4, y: 4 });
  });
});

describe("computeRigidTransform", () => {
  it("recovers a known rotation + translation", () => {
    const src = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const theta = 0.3;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    const tx = 5, ty = -3;
    const dst = src.map((p) => ({ x: cos * p.x - sin * p.y + tx, y: sin * p.x + cos * p.y + ty }));

    const tf = computeRigidTransform(src, dst);
    expect(tf.cos).toBeCloseTo(cos, 6);
    expect(tf.sin).toBeCloseTo(sin, 6);
    expect(tf.tx).toBeCloseTo(tx, 6);
    expect(tf.ty).toBeCloseTo(ty, 6);
  });

  it("recovers pure translation when rotation is disabled", () => {
    const src = [{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 4, y: 4 }];
    const dst = src.map((p) => ({ x: p.x + 7, y: p.y - 2 }));
    const tf = computeRigidTransform(src, dst, false);
    expect(tf.cos).toBe(1);
    expect(tf.sin).toBe(0);
    expect(tf.tx).toBeCloseTo(7, 6);
    expect(tf.ty).toBeCloseTo(-2, 6);
  });
});

describe("alignLapToReference", () => {
  // An L-shaped lap (2D extent so the fit is well-posed).
  function lShape(latOff = 0, lonOff = 0): GpsSample[] {
    const pts: Array<[number, number]> = [
      [40.0000, -74.0000],
      [40.0010, -74.0000],
      [40.0020, -74.0000],
      [40.0020, -74.0010],
      [40.0020, -74.0020],
    ];
    return pts.map(([lat, lon], i) => ({
      t: i * 100,
      lat: lat + latOff,
      lon: lon + lonOff,
      speedMps: 0, speedMph: 0, speedKph: 0,
      extraFields: {},
    }));
  }

  it("snaps a translated overlay back onto the reference", () => {
    const reference = lShape();
    const overlay = lShape(0.0004, -0.0003); // shifted ~tens of meters
    const aligned = alignLapToReference(overlay, reference);
    for (let i = 0; i < reference.length; i++) {
      expect(aligned[i].lat).toBeCloseTo(reference[i].lat, 4);
      expect(aligned[i].lon).toBeCloseTo(reference[i].lon, 4);
    }
  });

  it("preserves non-position fields", () => {
    const reference = lShape();
    const overlay = lShape(0.0004, 0).map((s) => ({ ...s, speedMph: 42 }));
    const aligned = alignLapToReference(overlay, reference);
    expect(aligned[0].speedMph).toBe(42);
    expect(aligned[0].t).toBe(overlay[0].t);
  });

  it("is a no-op for laps too short to fit", () => {
    const ref = lShape();
    const tiny: GpsSample[] = [ref[0], ref[1]];
    expect(alignLapToReference(tiny, ref)).toBe(tiny);
  });
});
