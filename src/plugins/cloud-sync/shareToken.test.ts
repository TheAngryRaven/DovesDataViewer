import { describe, expect, it } from "vitest";
import { bytesToBase64Url, generateShareToken } from "./shareToken";

describe("bytesToBase64Url", () => {
  it("maps known byte patterns to base64url", () => {
    expect(bytesToBase64Url(new Uint8Array([0, 0, 0]))).toBe("AAAA");
    expect(bytesToBase64Url(new Uint8Array([255, 255, 255]))).toBe("____");
    // 0xfb 0xef -> 111110 111110 1111(00) -> "-", "-", "8" without padding
    expect(bytesToBase64Url(new Uint8Array([0xfb, 0xef]))).toBe("--8");
    expect(bytesToBase64Url(new Uint8Array([]))).toBe("");
  });

  it("emits no padding and only URL-safe characters", () => {
    for (const len of [1, 2, 3, 4, 15, 16, 17]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37 + len) & 0xff);
      const s = bytesToBase64Url(bytes);
      expect(s).toMatch(/^[A-Za-z0-9\-_]*$/);
      expect(s).toHaveLength(Math.ceil((len * 4) / 3));
    }
  });
});

describe("generateShareToken", () => {
  it("produces 22-char URL-safe tokens", () => {
    const t = generateShareToken();
    expect(t).toHaveLength(22);
    expect(t).toMatch(/^[A-Za-z0-9\-_]{22}$/);
  });

  it("produces distinct tokens", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateShareToken()));
    expect(seen.size).toBe(50);
  });
});
