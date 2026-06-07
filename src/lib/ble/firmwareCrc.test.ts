import { describe, it, expect } from "vitest";
import { crc32, crc32Hex } from "./firmwareCrc";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("crc32 (IEEE 802.3 / zlib)", () => {
  it("matches the canonical check vectors", () => {
    // The standard CRC-32 "check" value for "123456789".
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(bytes("The quick brown fox jumps over the lazy dog"))).toBe(
      0x414fa339,
    );
  });

  it("is 0 for an empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("returns an unsigned 32-bit value", () => {
    const v = crc32(bytes("The quick brown fox jumps over the lazy dog"));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(0xffffffff);
  });

  it("is order-sensitive", () => {
    expect(crc32(bytes("ab"))).not.toBe(crc32(bytes("ba")));
  });

  it("handles binary (non-text) bytes", () => {
    const buf = new Uint8Array(256);
    for (let i = 0; i < 256; i++) buf[i] = i;
    // Stable, known CRC-32 of the bytes 0x00..0xFF.
    expect(crc32(buf)).toBe(0x29058c73);
  });
});

describe("crc32Hex", () => {
  it("formats as lowercase, zero-padded 8 hex chars", () => {
    expect(crc32Hex(bytes("123456789"))).toBe("cbf43926");
    expect(crc32Hex(new Uint8Array(0))).toBe("00000000");
  });
});
