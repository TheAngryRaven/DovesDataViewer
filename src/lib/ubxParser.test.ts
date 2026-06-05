/**
 * Unit tests for the u-blox UBX binary parser.
 *
 * UBX logs are a stream of framed messages: `B5 62 | class id | len(LE16) |
 * payload | ckA ckB`, where the Fletcher-8 checksum covers class..payload.
 * The parser only consumes NAV-PVT (class 0x01, id 0x07) messages with a valid
 * 3D fix and valid date/time flags. These tests synthesize real frames (correct
 * checksums) so we exercise the framing, field scaling, and reject paths.
 */

import { describe, it, expect } from "vitest";
import { isUbxFormat, parseUbxFile } from "./ubxParser";

interface PvtSpec {
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  min?: number;
  sec?: number;
  nanoMs?: number; // fractional ms expressed in whole ms, stored as nanoseconds
  valid?: number; // defaults to validTime|validDate (0x03)
  fixType?: number; // defaults to 3 (3D fix)
  numSV?: number;
  lat?: number; // degrees
  lon?: number; // degrees
  hMSLmm?: number;
  hAccMm?: number;
  vAccMm?: number;
  gSpeedMmps?: number;
  headMot?: number; // degrees
  sAccMmps?: number;
  pDOP?: number;
}

/** Build a single framed NAV-PVT message as bytes (sync + body + checksum). */
function frameNavPvt(p: PvtSpec): Uint8Array {
  const payload = new DataView(new ArrayBuffer(92));
  payload.setUint16(4, p.year ?? 2024, true);
  payload.setUint8(6, p.month ?? 3);
  payload.setUint8(7, p.day ?? 15);
  payload.setUint8(8, p.hour ?? 14);
  payload.setUint8(9, p.min ?? 30);
  payload.setUint8(10, p.sec ?? 0);
  payload.setUint8(11, p.valid ?? 0x03); // validTime | validDate
  payload.setInt32(16, Math.round((p.nanoMs ?? 0) * 1e6), true); // ms → ns
  payload.setUint8(20, p.fixType ?? 3);
  payload.setUint8(23, p.numSV ?? 12);
  payload.setInt32(24, Math.round((p.lon ?? -81.401) * 1e7), true);
  payload.setInt32(28, Math.round((p.lat ?? 28.401) * 1e7), true);
  payload.setInt32(36, p.hMSLmm ?? 100_000, true); // hMSL (mm) → 100 m
  payload.setUint32(40, p.hAccMm ?? 2_000, true); // hAcc (mm) → 2 m
  payload.setUint32(44, p.vAccMm ?? 3_000, true); // vAcc (mm) → 3 m
  payload.setInt32(60, p.gSpeedMmps ?? 20_000, true); // gSpeed (mm/s) → 20 m/s
  payload.setInt32(64, Math.round((p.headMot ?? 90) * 1e5), true);
  payload.setUint32(68, p.sAccMmps ?? 500, true); // sAcc (mm/s) → 0.5 m/s
  payload.setUint16(76, Math.round((p.pDOP ?? 1.2) * 100), true);

  // body = class, id, len(LE16), payload — checksum covers exactly this span.
  const body = new Uint8Array(4 + 92);
  body[0] = 0x01; // NAV class
  body[1] = 0x07; // PVT id
  body[2] = 92 & 0xff;
  body[3] = (92 >> 8) & 0xff;
  body.set(new Uint8Array(payload.buffer), 4);

  let ckA = 0;
  let ckB = 0;
  for (const b of body) {
    ckA = (ckA + b) & 0xff;
    ckB = (ckB + ckA) & 0xff;
  }

  const msg = new Uint8Array(2 + body.length + 2);
  msg[0] = 0xb5;
  msg[1] = 0x62;
  msg.set(body, 2);
  msg[2 + body.length] = ckA;
  msg[2 + body.length + 1] = ckB;
  return msg;
}

/** Concatenate framed messages (and optional raw byte runs) into one buffer. */
function concatBytes(...chunks: Uint8Array[]): ArrayBuffer {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out.buffer;
}

/** A simple two-sample track, 100 ms apart, moving slightly east. */
function twoSampleFile(): ArrayBuffer {
  return concatBytes(
    frameNavPvt({ sec: 0, nanoMs: 0, lat: 28.401, lon: -81.401 }),
    frameNavPvt({ sec: 0, nanoMs: 100, lat: 28.401, lon: -81.40099 })
  );
}

// ─── isUbxFormat ────────────────────────────────────────────────────────────

describe("isUbxFormat", () => {
  it("returns false for buffers shorter than 2 bytes", () => {
    expect(isUbxFormat(new Uint8Array([0xb5]).buffer)).toBe(false);
  });

  it("detects the sync pair within the first 200 bytes", () => {
    const junk = new Uint8Array(50).fill(0x11);
    const buf = concatBytes(junk, frameNavPvt({}));
    expect(isUbxFormat(buf)).toBe(true);
  });

  it("returns false when the sync pair only appears past the 200-byte window", () => {
    const junk = new Uint8Array(250).fill(0x11);
    const buf = concatBytes(junk, frameNavPvt({}));
    expect(isUbxFormat(buf)).toBe(false);
  });
});

// ─── parseUbxFile: happy path ───────────────────────────────────────────────

describe("parseUbxFile", () => {
  it("parses NAV-PVT messages into samples", () => {
    const parsed = parseUbxFile(twoSampleFile());
    expect(parsed.samples).toHaveLength(2);
  });

  it("makes the first sample t=0 and times subsequent samples relative to it", () => {
    const parsed = parseUbxFile(twoSampleFile());
    expect(parsed.samples[0].t).toBe(0);
    expect(parsed.samples[1].t).toBe(100); // 100 ms later
  });

  it("scales position from 1e-7 integer degrees", () => {
    const parsed = parseUbxFile(twoSampleFile());
    expect(parsed.samples[0].lat).toBeCloseTo(28.401, 6);
    expect(parsed.samples[0].lon).toBeCloseTo(-81.401, 6);
  });

  it("converts ground speed from mm/s to a consistent speed triple", () => {
    const parsed = parseUbxFile(twoSampleFile());
    const s = parsed.samples[0];
    expect(s.speedMps).toBeCloseTo(20, 5); // 20000 mm/s
    expect(s.speedMph).toBeCloseTo(s.speedMps * 2.23694, 4);
    expect(s.speedKph).toBeCloseTo(s.speedMps * 3.6, 4);
  });

  it("normalizes heading from the headMot field", () => {
    const parsed = parseUbxFile(
      concatBytes(
        frameNavPvt({ headMot: 90 }),
        frameNavPvt({ sec: 0, nanoMs: 100, lon: -81.40099, headMot: 91 })
      )
    );
    expect(parsed.samples[0].heading).toBeCloseTo(90, 3);
  });

  it("exposes scaled extra fields (sats, dop, altitude, accuracies)", () => {
    const parsed = parseUbxFile(twoSampleFile());
    const ef = parsed.samples[0].extraFields;
    expect(ef["Satellites"]).toBe(12);
    expect(ef["HDOP"]).toBeCloseTo(1.2, 5); // pDOP stand-in
    expect(ef["Altitude (m)"]).toBeCloseTo(100, 5); // 100000 mm
    expect(ef["H Accuracy (m)"]).toBeCloseTo(2, 5);
    expect(ef["V Accuracy (m)"]).toBeCloseTo(3, 5);
    expect(ef["Speed Acc (m/s)"]).toBeCloseTo(0.5, 5);
  });

  it("always adds GPS-derived Lat G / Lon G field mappings", () => {
    const parsed = parseUbxFile(twoSampleFile());
    const names = parsed.fieldMappings.map((m) => m.name);
    expect(names).toContain("Lat G");
    expect(names).toContain("Lon G");
  });

  it("derives startDate and duration from message timestamps", () => {
    const parsed = parseUbxFile(twoSampleFile());
    expect(parsed.startDate).toBeInstanceOf(Date);
    expect(parsed.duration).toBe(100);
  });
});

// ─── parseUbxFile: reject paths ─────────────────────────────────────────────

describe("parseUbxFile — rejected messages", () => {
  it("skips messages without a valid 3D fix (fixType < 2)", () => {
    expect(() => parseUbxFile(concatBytes(frameNavPvt({ fixType: 1 })))).toThrow(
      /No valid NAV-PVT/i
    );
  });

  it("skips messages missing the valid date/time flags", () => {
    // valid = 0 → neither validTime nor validDate set
    expect(() => parseUbxFile(concatBytes(frameNavPvt({ valid: 0 })))).toThrow(
      /No valid NAV-PVT/i
    );
  });

  it("skips (0,0) sentinel positions", () => {
    expect(() =>
      parseUbxFile(concatBytes(frameNavPvt({ lat: 0, lon: 0 })))
    ).toThrow(/No valid NAV-PVT/i);
  });

  it("drops a message whose checksum is corrupt", () => {
    const good = frameNavPvt({});
    const bad = frameNavPvt({});
    bad[bad.length - 1] ^= 0xff; // flip ckB → checksum mismatch
    // Only the corrupt message present → nothing parses.
    expect(() => parseUbxFile(concatBytes(bad))).toThrow(/No valid NAV-PVT/i);
    // Sanity: the un-corrupted twin parses fine.
    expect(parseUbxFile(concatBytes(good)).samples).toHaveLength(1);
  });

  it("ignores non-NAV-PVT message classes", () => {
    // Hand-roll a valid-checksum message with a different class/id (NAV-STATUS).
    const body = new Uint8Array(4 + 4);
    body[0] = 0x01; // NAV class
    body[1] = 0x03; // STATUS id (not PVT)
    body[2] = 4;
    body[3] = 0;
    let ckA = 0;
    let ckB = 0;
    for (const b of body) {
      ckA = (ckA + b) & 0xff;
      ckB = (ckB + ckA) & 0xff;
    }
    const other = new Uint8Array(2 + body.length + 2);
    other[0] = 0xb5;
    other[1] = 0x62;
    other.set(body, 2);
    other[2 + body.length] = ckA;
    other[2 + body.length + 1] = ckB;

    const parsed = parseUbxFile(
      concatBytes(other, frameNavPvt({}), frameNavPvt({ sec: 0, nanoMs: 100, lon: -81.40099 }))
    );
    expect(parsed.samples).toHaveLength(2); // the STATUS message is ignored
  });

  it("throws on a buffer with no UBX messages at all", () => {
    expect(() => parseUbxFile(new Uint8Array(64).fill(0).buffer)).toThrow();
  });
});
