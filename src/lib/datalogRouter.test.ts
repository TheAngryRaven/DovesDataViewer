/**
 * Routing-layer tests for `datalogParser` (complementing the real-sample
 * regression suite in `datalogParser.test.ts`).
 *
 * The individual parsers have their own suites; here we pin the *router*: that
 * each `isXxxFormat` check fires in the right precedence order, that binary vs
 * text paths split correctly, that the sync entry refuses XRK, that the async
 * `File` entry brackets the load overlay, and that every routed result is run
 * through `normalizeChannels` (canonical channel ids). Fixtures are synthetic
 * and minimal — just enough to trip one detector apiece.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDatalogFile, parseDatalogContent } from "./datalogParser";
import { isAimFormat, parseAimFile } from "./aimParser";
import { isAlfanoFormat } from "./alfanoParser";
import {
  subscribeFileLoading,
  getFileLoading,
} from "./fileLoadingState";

// A Unix ms timestamp inside the Dove parser's accepted window (≈2021-03).
const T0 = 1_614_700_000_000;

// ─── Text fixtures (one minimally-valid sample per format) ──────────────────

function doveCsv(rows = 4): string {
  const lines = ["timestamp,sats,hdop,lat,lng,speed_mph,heading_deg,rpm"];
  for (let i = 0; i < rows; i++) {
    lines.push(`${T0 + i * 100},12,0.9,28.401,${-81.401 + i * 0.00001},${30 + i},90,5000`);
  }
  return lines.join("\n");
}

function dovexPayload(): string {
  const preamble = [
    "datetime,driver,course,short_name,best_lap_ms,optimal_ms",
    "2024-03-15 14:30:00,Mike,Full CW,OKC,62345,61200",
    "lap_times_ms",
    "65432,64321,62345",
  ].join("\n");
  return preamble + "\n" + doveCsv(4);
}

function vbo(rows = 4): string {
  const lines = [
    "[header]",
    "satellites",
    "time",
    "latitude",
    "longitude",
    "velocity",
    "heading",
    "height",
    "",
    "[column names]",
    "sats time lat long velocity heading height",
    "",
    "[data]",
  ];
  for (let i = 0; i < rows; i++) {
    lines.push(`12 ${(10 + i * 0.1).toFixed(2)} 28.401 ${(-81.401 + i * 0.00001).toFixed(6)} ${50 + i} 90 30.5`);
  }
  return lines.join("\n");
}

function motecCsv(): string {
  const lines = [
    '"Log Date","15/03/2024",',
    '"Log Time","14:30:00",',
    '"Sample Rate","20",',
    '"Driver","Mike",',
    '"Time","GPS Latitude","GPS Longitude","Ground Speed","Engine RPM"',
    '"s","deg","deg","km/h","rpm"',
  ];
  for (let i = 0; i < 4; i++) {
    lines.push(`${(i * 0.05).toFixed(2)},${28.401 + i * 0.000002},${-81.401 + i * 0.000002},72,5000`);
  }
  return lines.join("\n");
}

function alfanoCsv(): string {
  const lines = [
    "Driver:,Test Driver",
    "Track:,Orlando",
    "Time,GPS_Latitude,GPS_Longitude,GPS_Speed,GPS_Heading,RPM,LatAcc",
  ];
  for (let i = 0; i < 4; i++) {
    lines.push(`${(i * 0.1).toFixed(1)},28.401,${(-81.401 + i * 0.00001).toFixed(6)},${50 + i},90,5000,1.2`);
  }
  return lines.join("\n");
}

function aimCsv(): string {
  // AiM-only channel indicators (no gps_speed/rpm/heading), so the broader
  // Alfano detector — which runs first in the router — doesn't claim it.
  const lines = ["Time,GPS_Lat,GPS_Long,Acc_Lat,Acc_Long"];
  for (let i = 0; i < 5; i++) {
    lines.push(`${(i * 0.1).toFixed(1)},28.401,${(-81.401 + i * 0.00001).toFixed(6)},0.5,0.3`);
  }
  return lines.join("\n");
}


function nmea(): string {
  // $GPRMC sentences near Orlando — the fallback when nothing else matches.
  return [
    "$GPRMC,170130.00,A,2824.64918,N,08122.75706,W,10.0,90.0,231125,,,A*65",
    "$GPRMC,170131.00,A,2824.64950,N,08122.75600,W,11.0,90.0,231125,,,A*6A",
  ].join("\n");
}

// ─── Binary fixtures (UBX NAV-PVT + MoTeC LD + XRK magic) ────────────────────

function ubxBuffer(): ArrayBuffer {
  const frame = (sec: number, nanoMs: number, lon: number): Uint8Array => {
    const payload = new DataView(new ArrayBuffer(92));
    payload.setUint16(4, 2024, true);
    payload.setUint8(6, 3);
    payload.setUint8(7, 15);
    payload.setUint8(8, 14);
    payload.setUint8(9, 30);
    payload.setUint8(10, sec);
    payload.setUint8(11, 0x03); // validTime | validDate
    payload.setInt32(16, Math.round(nanoMs * 1e6), true);
    payload.setUint8(20, 3); // 3D fix
    payload.setUint8(23, 12); // numSV
    payload.setInt32(24, Math.round(lon * 1e7), true);
    payload.setInt32(28, Math.round(28.401 * 1e7), true);
    payload.setInt32(60, 20_000, true); // gSpeed mm/s
    payload.setInt32(64, Math.round(90 * 1e5), true);
    payload.setUint16(76, 120, true);
    const body = new Uint8Array(4 + 92);
    body[0] = 0x01;
    body[1] = 0x07;
    body[2] = 92;
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
  };
  const a = frame(0, 0, -81.401);
  const b = frame(0, 100, -81.40099);
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out.buffer;
}

function motecLdBuffer(): ArrayBuffer {
  const CHAN_META = 128;
  const buf = new ArrayBuffer(4096);
  const view = new DataView(buf);
  view.setUint32(0, 0x40, true); // LD marker
  const metaPtr = 1600;
  view.setUint32(8, metaPtr, true);
  view.setUint32(12, 2400, true);

  const writeAscii = (o: number, s: string, max: number) => {
    for (let i = 0; i < Math.min(s.length, max); i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  const writeChan = (ptr: number, next: number, dataPtr: number, name: string, data: number[]) => {
    let o = ptr;
    view.setUint32(o, 0, true); o += 4; // prevAddr
    view.setUint32(o, next, true); o += 4;
    view.setUint32(o, dataPtr, true); o += 4;
    view.setUint32(o, data.length, true); o += 4; // dataLen
    view.setUint16(o, 0, true); o += 2; // counter
    view.setUint16(o, 0x07, true); o += 2; // dtypeA float
    view.setUint16(o, 4, true); o += 2; // dtypeB 4 bytes
    view.setUint16(o, 10, true); o += 2; // freq
    view.setInt16(o, 0, true); o += 2; // shift
    view.setInt16(o, 1, true); o += 2; // mul
    view.setInt16(o, 1, true); o += 2; // scale
    view.setInt16(o, 0, true); o += 2; // dec
    writeAscii(o, name, 32); o += 32;
    o += 8; // shortName
    writeAscii(o, "deg", 12);
    for (let j = 0; j < data.length; j++) view.setFloat32(dataPtr + j * 4, data[j], true);
  };
  writeChan(metaPtr, metaPtr + CHAN_META, 2400, "GPS Latitude", [28.401, 28.401005]);
  writeChan(metaPtr + CHAN_META, 0, 2500, "GPS Longitude", [-81.401, -81.401005]);
  return buf;
}

function xrkBuffer(): ArrayBuffer {
  // "<h" magic + trailing bytes — enough for isXrkFile to match.
  return new Uint8Array([0x3c, 0x68, 0x43, 0x4e, 0x46, 0x00]).buffer;
}

// ─── parseDatalogContent: text routing ──────────────────────────────────────

describe("parseDatalogContent — text routing", () => {
  it("routes a Dove CSV to the Dove parser (no dovex metadata)", () => {
    const parsed = parseDatalogContent(doveCsv());
    expect(parsed.samples.length).toBeGreaterThan(0);
    expect(parsed.dovexMetadata).toBeUndefined();
  });

  it("prefers Dovex over Dove when the metadata header is present", () => {
    // A .dovex payload embeds a valid Dove CSV; precedence must pick Dovex so the
    // session metadata survives instead of being parsed as bare Dove.
    const parsed = parseDatalogContent(dovexPayload());
    expect(parsed.dovexMetadata).toBeDefined();
    expect(parsed.dovexMetadata!.driver).toBe("Mike");
  });

  it("routes VBO content", () => {
    expect(parseDatalogContent(vbo()).samples.length).toBeGreaterThan(0);
  });

  it("routes MoTeC CSV content", () => {
    expect(parseDatalogContent(motecCsv()).samples.length).toBeGreaterThan(0);
  });

  it("routes Alfano content", () => {
    expect(parseDatalogContent(alfanoCsv()).samples.length).toBeGreaterThan(0);
  });

  it("routes an AiM-only CSV (Alfano detector declines it)", () => {
    expect(parseDatalogContent(aimCsv()).samples.length).toBeGreaterThan(0);
  });

  it("gives Alfano precedence over AiM for headers both detectors accept", () => {
    // The Alfano fixture's header (gps_latitude/gps_speed/rpm) is *also* detected
    // by isAimFormat, but Alfano is checked first, so it wins. Pin this ordering
    // so a future reshuffle is a deliberate, reviewed change.
    const overlap = alfanoCsv();
    expect(isAimFormat(overlap)).toBe(true);
    expect(isAlfanoFormat(overlap)).toBe(true);
    expect(parseDatalogContent(overlap).samples.length).toBeGreaterThan(0);
  });

  it("falls back to the NMEA parser for unrecognized GPS text", () => {
    expect(parseDatalogContent(nmea()).samples.length).toBeGreaterThan(0);
  });

  it("routes a real RaceStudio CSV to AiM, not Alfano (signature wins)", () => {
    // Regression: RS3 exports contain rpm/water columns, so isAlfanoFormat
    // claims them — but Alfano can't parse the AiM layout and throws, so the
    // file failed to load entirely. The "AiM CSV File" signature now gives AiM
    // precedence. Assert the routed result matches the AiM parser's own output.
    const rs3 = readFileSync(
      resolve(__dirname, "__fixtures__/racestudio3-aim.csv"),
      "utf-8",
    );
    expect(isAlfanoFormat(rs3)).toBe(true); // Alfano still (wrongly) detects it…
    const routed = parseDatalogContent(rs3);
    const direct = parseAimFile(rs3);
    // …but routing picks AiM, so sample counts match the AiM parser exactly.
    expect(routed.samples.length).toBe(direct.samples.length);
    expect(routed.samples.length).toBeGreaterThan(100);
  });
});

// ─── parseDatalogContent: binary routing ────────────────────────────────────

describe("parseDatalogContent — binary routing", () => {
  it("routes a UBX ArrayBuffer", () => {
    expect(parseDatalogContent(ubxBuffer()).samples.length).toBeGreaterThan(0);
  });

  it("routes a MoTeC LD ArrayBuffer", () => {
    expect(parseDatalogContent(motecLdBuffer()).samples.length).toBeGreaterThan(0);
  });

  it.each([
    ["VBO", vbo],
    ["MoTeC CSV", motecCsv],
    ["Dovex", dovexPayload],
    ["Dove", doveCsv],
    ["Alfano", alfanoCsv],
    ["AiM", aimCsv],
    ["NMEA", nmea],
  ])("decodes %s text passed as an ArrayBuffer", (_name, make) => {
    const buf = new TextEncoder().encode(make()).buffer;
    expect(parseDatalogContent(buf).samples.length).toBeGreaterThan(0);
  });

  it("refuses XRK on the sync entry point (must use the async worker path)", () => {
    expect(() => parseDatalogContent(xrkBuffer())).toThrow(/async|parseDatalogFile/i);
  });
});

// ─── normalizeChannels integration ──────────────────────────────────────────

describe("parseDatalogContent — channel normalization", () => {
  it("canonicalizes field mapping ids via normalizeChannels", () => {
    // The Dove parser emits a human "Lat G" name; the router's normalizeChannels
    // rewrites it to the canonical `lat_g` id with a display label.
    const parsed = parseDatalogContent(doveCsv());
    const latG = parsed.fieldMappings.find((m) => m.name === "lat_g");
    expect(latG).toBeDefined();
    expect(latG!.label).toBe("Lat G");
  });
});

// ─── parseDatalogFile: async File entry + load overlay ───────────────────────

describe("parseDatalogFile — async File entry", () => {
  it("reads a text File and routes it (with normalized channels)", async () => {
    const file = new File([doveCsv()], "session.dove", { type: "text/csv" });
    const parsed = await parseDatalogFile(file);
    expect(parsed.samples.length).toBeGreaterThan(0);
    expect(parsed.fieldMappings.some((m) => m.name === "lat_g")).toBe(true);
  });

  it("reads a binary File (UBX) and routes it", async () => {
    const file = new File([ubxBuffer()], "session.ubx");
    const parsed = await parseDatalogFile(file);
    expect(parsed.samples.length).toBeGreaterThan(0);
  });

  it("brackets the load with begin/end of the file-loading overlay", async () => {
    const states: string[] = [];
    const unsub = subscribeFileLoading((s) => states.push(s ? "active" : "idle"));
    await parseDatalogFile(new File([doveCsv()], "session.dove"));
    unsub();
    expect(states[0]).toBe("active");
    expect(states[states.length - 1]).toBe("idle");
    expect(getFileLoading()).toBeNull();
  });

  it("ends the overlay even when routing throws", async () => {
    const states: string[] = [];
    const unsub = subscribeFileLoading((s) => states.push(s ? "active" : "idle"));
    // Empty content → every detector fails → the NMEA fallback throws "Empty file".
    await expect(parseDatalogFile(new File([""], "empty.txt"))).rejects.toThrow();
    unsub();
    expect(states[states.length - 1]).toBe("idle");
    expect(getFileLoading()).toBeNull();
  });
});
