/**
 * Unit tests for the parse-error support-report helpers (plan 0013).
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeReportFileName,
  formatReportFileSize,
  gzipBlob,
  buildParseReportForm,
  MAX_UPLOAD_BYTES,
} from "./parseReport";

describe("sanitizeReportFileName", () => {
  it("keeps normal datalog names intact", () => {
    expect(sanitizeReportFileName("session_2026-07-05 (2).csv")).toBe("session_2026-07-05 (2).csv");
  });

  it("strips directory components", () => {
    expect(sanitizeReportFileName("C:\\logs\\run.csv")).toBe("run.csv");
    expect(sanitizeReportFileName("/tmp/run.nmea")).toBe("run.nmea");
  });

  it("replaces unsafe characters and caps length", () => {
    expect(sanitizeReportFileName("we?ird*na<me>.csv")).toBe("we_ird_na_me_.csv");
    expect(sanitizeReportFileName("x".repeat(300) + ".csv")).toHaveLength(120);
  });

  it("falls back for empty names", () => {
    expect(sanitizeReportFileName("")).toBe("datalog");
    expect(sanitizeReportFileName("///")).toBe("datalog");
  });
});

describe("formatReportFileSize", () => {
  it("formats bytes, KB, and MB", () => {
    expect(formatReportFileSize(512)).toBe("512 B");
    expect(formatReportFileSize(2048)).toBe("2.0 KB");
    expect(formatReportFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("gzipBlob", () => {
  it("round-trips content through gzip", async () => {
    const original = "Lap;Time;Speed GPS\n".repeat(1000);
    const gz = await gzipBlob(new Blob([original]));
    expect(gz).not.toBeNull();
    expect(gz!.size).toBeLessThan(original.length);
    const restored = await new Response(
      gz!.stream().pipeThrough(new DecompressionStream("gzip")),
    ).text();
    expect(restored).toBe(original);
  });
});

describe("buildParseReportForm", () => {
  const makeFile = (content: string, name = "log.csv") =>
    new File([content], name, { type: "text/csv" });

  it("builds a multipart form with all fields", async () => {
    const form = await buildParseReportForm({
      file: makeFile("a;b;c\n".repeat(500)),
      message: "  Alfano 6 via ADA app  ",
      email: "user@example.com",
      errorText: "Could not find valid header row",
      appVersion: "3.1.2 (abc1234)",
    });
    expect(form).not.toBe("too-large");
    const f = form as FormData;
    expect(f.get("message")).toBe("Alfano 6 via ADA app");
    expect(f.get("email")).toBe("user@example.com");
    expect(f.get("errorText")).toBe("Could not find valid header row");
    expect(f.get("appVersion")).toBe("3.1.2 (abc1234)");
    expect(f.get("fileName")).toBe("log.csv");
    expect(Number(f.get("fileSize"))).toBe(makeFile("a;b;c\n".repeat(500)).size);
  });

  it("gzips compressible files and marks the compression", async () => {
    const form = (await buildParseReportForm({
      file: makeFile("0.01;52.30;-106.64;515\n".repeat(2000)),
      message: "m",
    })) as FormData;
    expect(form.get("compression")).toBe("gzip");
    const upload = form.get("file") as File;
    expect(upload.name).toBe("log.csv.gz");
    expect(upload.size).toBeLessThan(makeFile("0.01;52.30;-106.64;515\n".repeat(2000)).size);
    // fileSize still reports the ORIGINAL bytes for the admin listing
    expect(Number(form.get("fileSize"))).toBeGreaterThan(upload.size);
  });

  it("omits empty optional fields", async () => {
    const form = (await buildParseReportForm({ file: makeFile("x"), message: "m" })) as FormData;
    expect(form.get("email")).toBeNull();
    expect(form.get("errorText")).toBeNull();
    expect(form.get("appVersion")).toBeNull();
  });

  it("rejects payloads over the upload ceiling", async () => {
    // Incompressible content just over the cap: xorshift32 noise doesn't gzip,
    // so the fallback raw payload (and the gz attempt alike) stays too big.
    const bytes = new Uint8Array(MAX_UPLOAD_BYTES + 1024 * 1024);
    let s = 0x12345678;
    for (let i = 0; i < bytes.length; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      bytes[i] = s & 0xff;
    }
    const big = new File([bytes], "big.xrk");
    expect(big.size).toBeGreaterThan(MAX_UPLOAD_BYTES);
    const result = await buildParseReportForm({ file: big, message: "m" });
    expect(result).toBe("too-large");
  });
});
