/**
 * Unit tests for the MoTeC parser (CSV export + native .ld binary).
 *
 * - CSV: a quoted metadata header block, a "Time"-led channel-name row, a units
 *   row, then data. Detection needs >=3 MoTeC-specific header lines.
 * - LD: a binary log. We synthesize a minimal file — header pointer block + a
 *   two-channel linked list (GPS Latitude/Longitude) with float32 sample data —
 *   to exercise the channel-walk and decode without shipping a real binary.
 */

import { describe, it, expect } from "vitest";
import {
  isMotecCsvFormat,
  parseMotecCsvFile,
  isMotecLdFormat,
  parseMotecLdFile,
} from "./motecParser";

// ─── MoTeC CSV ──────────────────────────────────────────────────────────────

function makeMotecCsv(
  opts: { speedUnit?: string; rows?: number } = {}
): string {
  const { speedUnit = "km/h", rows = 3 } = opts;
  const lines = [
    '"MoTeC CSV File",,,',
    '"Log Date","15/03/2024",',
    '"Log Time","14:30:00",',
    '"Sample Rate","20",',
    '"Driver","Mike",',
    '"Device","ADL3",',
    "",
    '"Time","GPS Latitude","GPS Longitude","Ground Speed","Engine RPM","G Force Lat","G Force Long"',
    `"s","deg","deg","${speedUnit}","rpm","g","g"`,
  ];
  for (let i = 0; i < rows; i++) {
    const t = (i * 0.05).toFixed(2); // 20 Hz
    // Tiny per-step movement so the 100 m/s teleportation filter never trips.
    const lat = 28.401 + i * 0.000002;
    const lon = -81.401 + i * 0.000002;
    // 72 km/h ≈ 20 m/s
    lines.push(`${t},${lat},${lon},72,5000,0.1,0.2`);
  }
  return lines.join("\n");
}

describe("isMotecCsvFormat", () => {
  it("accepts a header with >=3 MoTeC indicator lines", () => {
    expect(isMotecCsvFormat(makeMotecCsv())).toBe(true);
  });

  it("rejects a generic CSV with too few MoTeC markers", () => {
    const csv = "a,b,c\n1,2,3\n4,5,6";
    expect(isMotecCsvFormat(csv)).toBe(false);
  });
});

describe("parseMotecCsvFile", () => {
  it("parses data rows into samples with GPS coords", () => {
    const parsed = parseMotecCsvFile(makeMotecCsv({ rows: 4 }));
    expect(parsed.samples).toHaveLength(4);
    expect(parsed.samples[0].lat).toBeCloseTo(28.401, 6);
    expect(parsed.samples[0].lon).toBeCloseTo(-81.401, 6);
  });

  it("reads time in seconds and converts to ms", () => {
    const parsed = parseMotecCsvFile(makeMotecCsv({ rows: 3 }));
    expect(parsed.samples[0].t).toBe(0);
    expect(parsed.samples[1].t).toBeCloseTo(50, 6); // 0.05 s → 50 ms
  });

  it("converts km/h ground speed to m/s by default", () => {
    const parsed = parseMotecCsvFile(makeMotecCsv({ speedUnit: "km/h" }));
    expect(parsed.samples[0].speedMps).toBeCloseTo(20, 5); // 72 km/h
  });

  it("honors an mph speed unit", () => {
    const parsed = parseMotecCsvFile(makeMotecCsv({ speedUnit: "mph" }));
    // 72 mph → ~32.19 m/s
    expect(parsed.samples[0].speedMps).toBeCloseTo(72 * 0.44704, 4);
  });

  it("maps named channels into extra fields (RPM + native G)", () => {
    const parsed = parseMotecCsvFile(makeMotecCsv());
    const ef = parsed.samples[0].extraFields;
    expect(ef["RPM"]).toBe(5000);
    // Logger-reported G lands on the native channels (channels.ts contract);
    // the primary Lat G / Lon G pair is GPS-derived and coexists with it.
    expect(ef["Lat G (Native)"]).toBeCloseTo(0.1, 6);
    expect(ef["Lon G (Native)"]).toBeCloseTo(0.2, 6);
    expect(ef["Lat G"]).toBeDefined();
    expect(ef["Lon G"]).toBeDefined();
  });

  it("throws when GPS latitude/longitude channels are absent", () => {
    const csv = [
      '"Log Date","15/03/2024",',
      '"Log Time","14:30:00",',
      '"Sample Rate","20",',
      '"Time","Ground Speed","Engine RPM"',
      '"s","km/h","rpm"',
      "0.0,72,5000",
    ].join("\n");
    expect(() => parseMotecCsvFile(csv)).toThrow(/Latitude\/Longitude/i);
  });

  it("throws when no channel header row is found", () => {
    const csv = '"Log Date","x",\n"Log Time","y",\n"Sample Rate","20",';
    expect(() => parseMotecCsvFile(csv)).toThrow(/channel header/i);
  });
});

// ─── MoTeC LD binary ────────────────────────────────────────────────────────

const HEAD_SIZE = 1594;
const CHAN_META_SIZE = 128;

function writeAscii(view: DataView, offset: number, str: string, maxLen: number) {
  for (let i = 0; i < Math.min(str.length, maxLen); i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

interface LdChannelSpec {
  name: string;
  dataPtr: number;
  data: number[];
  nextMetaPtr: number;
  freq?: number;
}

/** Write one float32-typed channel meta block at `ptr`. */
function writeChannelMeta(view: DataView, ptr: number, ch: LdChannelSpec) {
  let o = ptr;
  view.setUint32(o, 0, true); o += 4; // prevAddr
  view.setUint32(o, ch.nextMetaPtr, true); o += 4;
  view.setUint32(o, ch.dataPtr, true); o += 4;
  view.setUint32(o, ch.data.length, true); o += 4; // dataLen
  view.setUint16(o, 0, true); o += 2; // counter
  view.setUint16(o, 0x07, true); o += 2; // dtypeA → float
  view.setUint16(o, 4, true); o += 2; // dtypeB → 4 bytes (float32)
  view.setUint16(o, ch.freq ?? 10, true); o += 2; // freq
  view.setInt16(o, 0, true); o += 2; // shift
  view.setInt16(o, 1, true); o += 2; // mul
  view.setInt16(o, 1, true); o += 2; // scale
  view.setInt16(o, 0, true); o += 2; // dec
  writeAscii(view, o, ch.name, 32); o += 32; // name
  o += 8; // shortName (left blank)
  writeAscii(view, o, "deg", 12); // unit
}

/** Build a minimal but valid MoTeC LD buffer with the given channels. */
function makeMotecLd(channels: LdChannelSpec[], metaPtr = 1600): ArrayBuffer {
  const buf = new ArrayBuffer(4096);
  const view = new DataView(buf);

  view.setUint32(0, 0x40, true); // LD marker
  view.setUint32(8, metaPtr, true); // meta pointer
  view.setUint32(12, 2400, true); // data pointer (unused by reader)

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    writeChannelMeta(view, metaPtr + i * CHAN_META_SIZE, ch);
    for (let j = 0; j < ch.data.length; j++) {
      view.setFloat32(ch.dataPtr + j * 4, ch.data[j], true);
    }
  }
  return buf;
}

function makeTwoChannelLd(): ArrayBuffer {
  const ptr1 = 1600;
  const ptr2 = ptr1 + CHAN_META_SIZE;
  return makeMotecLd([
    {
      name: "GPS Latitude",
      dataPtr: 2400,
      // Tiny movement keeps the second sample under the teleportation cap.
      data: [28.401, 28.401005],
      nextMetaPtr: ptr2,
      freq: 10,
    },
    {
      name: "GPS Longitude",
      dataPtr: 2500,
      data: [-81.401, -81.401005],
      nextMetaPtr: 0, // end of linked list
      freq: 10,
    },
  ]);
}

describe("isMotecLdFormat", () => {
  it("detects the 0x40 marker on a sufficiently large buffer", () => {
    expect(isMotecLdFormat(makeTwoChannelLd())).toBe(true);
  });

  it("rejects buffers smaller than the header size", () => {
    expect(isMotecLdFormat(new ArrayBuffer(HEAD_SIZE - 1))).toBe(false);
  });

  it("rejects a large buffer without the marker", () => {
    expect(isMotecLdFormat(new ArrayBuffer(4096))).toBe(false);
  });
});

describe("parseMotecLdFile", () => {
  it("walks the channel list and decodes GPS samples", () => {
    const parsed = parseMotecLdFile(makeTwoChannelLd());
    expect(parsed.samples).toHaveLength(2);
    expect(parsed.samples[0].lat).toBeCloseTo(28.401, 5);
    expect(parsed.samples[0].lon).toBeCloseTo(-81.401, 5);
  });

  it("times samples from the GPS channel frequency", () => {
    const parsed = parseMotecLdFile(makeTwoChannelLd());
    // freq 10 Hz → 100 ms spacing
    expect(parsed.samples[0].t).toBe(0);
    expect(parsed.samples[1].t).toBeCloseTo(100, 6);
  });

  it("fills GPS-derived Lat G / Lon G when no native G channel is present", () => {
    const parsed = parseMotecLdFile(makeTwoChannelLd());
    const names = parsed.fieldMappings.map((m) => m.name);
    expect(names).toContain("Lat G");
    expect(names).toContain("Lon G");
  });

  it("throws when GPS channels are missing", () => {
    const buf = makeMotecLd([
      { name: "Engine RPM", dataPtr: 2400, data: [5000, 5050], nextMetaPtr: 0 },
    ]);
    expect(() => parseMotecLdFile(buf)).toThrow(/Latitude\/Longitude/i);
  });
});
