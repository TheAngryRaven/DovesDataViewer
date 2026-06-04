import { describe, it, expect } from "vitest";
import { isXrkFile } from "./xrkImporter";

function buf(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

describe("isXrkFile", () => {
  it("matches by .xrk / .xrz extension (case-insensitive)", () => {
    expect(isXrkFile("session.xrk")).toBe(true);
    expect(isXrkFile("session.XRZ")).toBe(true);
    expect(isXrkFile("My Log.0033.xrk")).toBe(true);
  });

  it("does not match other datalog extensions", () => {
    expect(isXrkFile("session.csv")).toBe(false);
    expect(isXrkFile("session.ld")).toBe(false);
    expect(isXrkFile("session.vbo")).toBe(false);
  });

  it("matches a raw, extension-less XRK by its `<h` magic", () => {
    // "<h" = 0x3c 0x68
    expect(isXrkFile("unknownfile", buf([0x3c, 0x68, 0x43, 0x4e, 0x46]))).toBe(true);
  });

  it("does not match non-XRK bytes without a known extension", () => {
    expect(isXrkFile("data", buf([0x00, 0x01, 0x02]))).toBe(false);
    expect(isXrkFile("", buf([0x3d, 0x68]))).toBe(false);
  });
});
