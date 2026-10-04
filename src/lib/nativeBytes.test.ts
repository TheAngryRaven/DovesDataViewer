import { describe, it, expect, vi, afterEach } from "vitest";
import { blobToBase64, bytesToBase64, NATIVE_CHUNK_BYTES } from "./nativeBytes";

/** Naive reference encoder. */
function referenceBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function pattern(n: number, mul = 1): Uint8Array {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = (i * mul) % 256;
  return bytes;
}

/**
 * A stand-in for the browser's FileReader: `readAsDataURL` produces the same
 * `data:<mime>;base64,<payload>` shape, asynchronously, from the Blob's bytes.
 */
class FakeFileReader {
  result: string | null = null;
  error: Error | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  static failNext = false;
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then((buf) => {
      if (FakeFileReader.failNext) {
        FakeFileReader.failNext = false;
        this.error = new Error("NotReadableError");
        this.onerror?.();
        return;
      }
      const mime = blob.type || "application/octet-stream";
      this.result = `data:${mime};base64,${referenceBase64(new Uint8Array(buf))}`;
      this.onload?.();
    });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bytesToBase64", () => {
  it("matches a reference encoder across the 32 KB step boundary", () => {
    const bytes = pattern(100_003, 7);
    const b64 = bytesToBase64(bytes);
    expect(b64).toBe(referenceBase64(bytes));
    // Round-trips byte-for-byte.
    expect(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))).toEqual(bytes);
  });

  it("encodes the empty input as the empty string", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });
});

describe("blobToBase64", () => {
  it("falls back to the pure encoder where there is no FileReader (this test runtime)", async () => {
    expect(typeof FileReader).toBe("undefined");
    const bytes = pattern(1000);
    expect(await blobToBase64(new Blob([bytes]))).toBe(referenceBase64(bytes));
    expect(await blobToBase64(new Blob([]))).toBe("");
  });

  it("uses FileReader.readAsDataURL and strips the prefix regardless of the blob's mime type", async () => {
    vi.stubGlobal("FileReader", FakeFileReader);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const expected = referenceBase64(png);
    expect(await blobToBase64(new Blob([png], { type: "image/png" }))).toBe(expected);
    expect(await blobToBase64(new Blob([png], { type: "video/mp4" }))).toBe(expected);
    expect(await blobToBase64(new Blob([png]))).toBe(expected);
    expect(await blobToBase64(new Blob([]))).toBe("");
  });

  it("encodes a slice of a larger blob independently", async () => {
    vi.stubGlobal("FileReader", FakeFileReader);
    const bytes = pattern(3000, 7);
    const chunk = await blobToBase64(new Blob([bytes]).slice(1000, 2000));
    expect(chunk).toBe(referenceBase64(bytes.subarray(1000, 2000)));
  });

  it("rejects with the reader's error", async () => {
    vi.stubGlobal("FileReader", FakeFileReader);
    FakeFileReader.failNext = true;
    await expect(blobToBase64(new Blob([1, 2, 3].map(String)))).rejects.toThrow("NotReadableError");
  });
});

describe("NATIVE_CHUNK_BYTES", () => {
  it("keeps one base64 message in the single-digit megabytes", () => {
    // Each chunk is decoded on its own (padding per chunk is fine), so the
    // only constraint is the per-message size.
    expect(NATIVE_CHUNK_BYTES).toBeGreaterThanOrEqual(1024 * 1024);
    expect((NATIVE_CHUNK_BYTES * 4) / 3).toBeLessThan(8 * 1024 * 1024);
  });
});
