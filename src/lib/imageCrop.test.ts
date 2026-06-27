import { describe, it, expect } from "vitest";
import { computeSquareCrop } from "./imageCrop";

describe("computeSquareCrop", () => {
  it("centers the crop on a landscape image and caps the output", () => {
    // 800x400 → 400 square, offset 200 on x, downscaled to 256.
    expect(computeSquareCrop(800, 400, 256)).toEqual({ sx: 200, sy: 0, side: 400, target: 256 });
  });

  it("centers the crop on a portrait image", () => {
    expect(computeSquareCrop(400, 800, 256)).toEqual({ sx: 0, sy: 200, side: 400, target: 256 });
  });

  it("keeps a square image unchanged except for the cap", () => {
    expect(computeSquareCrop(500, 500, 256)).toEqual({ sx: 0, sy: 0, side: 500, target: 256 });
  });

  it("never upscales below the cap", () => {
    // A 120x90 image: square side 90, target stays 90 (not 256).
    expect(computeSquareCrop(120, 90, 256)).toEqual({ sx: 15, sy: 0, side: 90, target: 90 });
  });

  it("floors odd offsets so the crop stays inside the source", () => {
    // 401x400 → side 400, (401-400)/2 = 0.5 → floored to 0.
    expect(computeSquareCrop(401, 400, 256)).toEqual({ sx: 0, sy: 0, side: 400, target: 256 });
  });
});
