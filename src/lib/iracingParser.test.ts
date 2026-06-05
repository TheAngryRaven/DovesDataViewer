/**
 * Unit tests for the iRacing .ibt (iRacing Binary Telemetry) parser.
 *
 * The .ibt layout is: 112-byte irsdk_header → 32-byte diskSubHeader → session
 * YAML → varHeader[numVars] (144 bytes each) → fixed-stride data rows. The
 * builder below mints a minimal-but-valid file so the parser can be exercised
 * without a real multi-MB capture.
 */

import { describe, it, expect } from 'vitest';
import { isIracingFormat, parseIracingFile } from './iracingParser';
import { parseDatalogContent } from './datalogParser';
import { STANDARD_GRAVITY_MPS2 } from './parserUtils';

// ─── Synthetic .ibt fixture ─────────────────────────────────────────────────

const HEADER_SIZE = 112;
const SUBHEADER_SIZE = 32;
const VAR_HEADER_SIZE = 144;

// irsdk_VarType ids
const T_INT = 2;
const T_FLOAT = 4;
const T_DOUBLE = 5;

interface VarDef {
  name: string;
  type: number;
  unit?: string;
  /** value for record i */
  value: (i: number) => number;
}

const TYPE_BYTES: Record<number, number> = { 0: 1, 1: 1, 2: 4, 3: 4, 4: 4, 5: 8 };

function writeAscii(bytes: Uint8Array, off: number, str: string): void {
  for (let i = 0; i < str.length; i++) bytes[off + i] = str.charCodeAt(i);
}

interface IbtOpts {
  vars: VarDef[];
  records: number;
  startUnix?: number;
  /** Override the embedded session YAML (defaults to a WeekendInfo block). */
  yaml?: string;
}

function makeIbt(opts: IbtOpts): ArrayBuffer {
  const { vars, records } = opts;
  const yaml = opts.yaml ?? '---\nWeekendInfo:\n TrackName: testtrack\n...\n';

  // Assign each channel a sequential in-row byte offset.
  let bufLen = 0;
  const rowOffsets = vars.map((v) => {
    const at = bufLen;
    bufLen += TYPE_BYTES[v.type];
    return at;
  });

  const sessionInfoOffset = HEADER_SIZE + SUBHEADER_SIZE;
  const varHeaderOffset = sessionInfoOffset + yaml.length;
  const dataOffset = varHeaderOffset + vars.length * VAR_HEADER_SIZE;
  const totalSize = dataOffset + records * bufLen;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // irsdk_header
  view.setInt32(0, 2, true); // ver
  view.setInt32(8, 60, true); // tickRate
  view.setInt32(16, yaml.length, true); // sessionInfoLen
  view.setInt32(20, sessionInfoOffset, true);
  view.setInt32(24, vars.length, true); // numVars
  view.setInt32(28, varHeaderOffset, true);
  view.setInt32(32, 1, true); // numBuf
  view.setInt32(36, bufLen, true);
  view.setInt32(48, records, true); // varBuf[0].tickCount
  view.setInt32(52, dataOffset, true); // varBuf[0].bufOffset

  // diskSubHeader
  view.setBigInt64(HEADER_SIZE, BigInt(opts.startUnix ?? 0), true); // sessionStartDate
  view.setInt32(HEADER_SIZE + 28, records, true); // sessionRecordCount

  // session YAML
  writeAscii(bytes, sessionInfoOffset, yaml);

  // varHeaders
  vars.forEach((v, i) => {
    const vh = varHeaderOffset + i * VAR_HEADER_SIZE;
    view.setInt32(vh, v.type, true);
    view.setInt32(vh + 4, rowOffsets[i], true); // in-row offset
    view.setInt32(vh + 8, 1, true); // count
    writeAscii(bytes, vh + 16, v.name);
    if (v.unit) writeAscii(bytes, vh + 16 + 32 + 64, v.unit);
  });

  // data rows
  for (let r = 0; r < records; r++) {
    const rowBase = dataOffset + r * bufLen;
    vars.forEach((v, i) => {
      const at = rowBase + rowOffsets[i];
      const value = v.value(r);
      if (v.type === T_DOUBLE) view.setFloat64(at, value, true);
      else if (v.type === T_FLOAT) view.setFloat32(at, value, true);
      else view.setInt32(at, value, true);
    });
  }

  return buffer;
}

/** A representative file: GPS + driver inputs + native g, 5 records. */
function sampleIbt(): ArrayBuffer {
  return makeIbt({
    records: 5,
    startUnix: 1_700_000_000,
    vars: [
      { name: 'SessionTime', type: T_DOUBLE, unit: 's', value: (i) => 100 + i * 0.1 },
      { name: 'Lat', type: T_DOUBLE, unit: 'deg', value: () => 36.27 },
      { name: 'Lon', type: T_DOUBLE, unit: 'deg', value: (i) => -115.01 + i * 0.0001 },
      { name: 'Speed', type: T_FLOAT, unit: 'm/s', value: () => 50 },
      { name: 'Alt', type: T_FLOAT, unit: 'm', value: () => 620 },
      { name: 'RPM', type: T_FLOAT, unit: 'rpm', value: () => 7000 },
      { name: 'Throttle', type: T_FLOAT, unit: '%', value: () => 0.5 },
      { name: 'Gear', type: T_INT, unit: '', value: () => 3 },
      { name: 'LatAccel', type: T_FLOAT, unit: 'm/s^2', value: () => STANDARD_GRAVITY_MPS2 },
    ],
  });
}

// ─── isIracingFormat ────────────────────────────────────────────────────────

describe('isIracingFormat', () => {
  it('accepts a synthetic .ibt', () => {
    expect(isIracingFormat(sampleIbt())).toBe(true);
  });

  it('rejects a too-short buffer', () => {
    expect(isIracingFormat(new ArrayBuffer(8))).toBe(false);
  });

  it('rejects random bytes', () => {
    const buf = new ArrayBuffer(2048);
    new Uint8Array(buf).fill(0xab);
    expect(isIracingFormat(buf)).toBe(false);
  });

  it('rejects a header without the WeekendInfo YAML marker', () => {
    const buf = makeIbt({
      records: 2,
      yaml: '---\nSomethingElse:\n Foo: bar\n...\n',
      vars: [
        { name: 'Lat', type: T_DOUBLE, value: () => 36.27 },
        { name: 'Lon', type: T_DOUBLE, value: (i) => -115.01 + i * 0.0001 },
      ],
    });
    expect(isIracingFormat(buf)).toBe(false);
  });
});

// ─── parseIracingFile ───────────────────────────────────────────────────────

describe('parseIracingFile', () => {
  it('parses GPS samples with the three-unit speed triple', () => {
    const data = parseIracingFile(sampleIbt());
    expect(data.samples).toHaveLength(5);
    const s0 = data.samples[0];
    expect(s0.lat).toBeCloseTo(36.27, 5);
    expect(s0.lon).toBeCloseTo(-115.01, 5);
    expect(s0.speedMps).toBeCloseTo(50, 5);
    expect(s0.speedMph).toBeCloseTo(50 * 2.23694, 2);
    expect(s0.speedKph).toBeCloseTo(180, 2);
  });

  it('zeroes the timebase at the first SessionTime', () => {
    const data = parseIracingFile(sampleIbt());
    expect(data.samples[0].t).toBe(0);
    expect(data.samples[1].t).toBeCloseTo(100, 5); // 0.1s later
    expect(data.duration).toBeCloseTo(400, 5);
  });

  it('maps optional channels and applies unit transforms', () => {
    const { extraFields } = parseIracingFile(sampleIbt()).samples[0];
    expect(extraFields['RPM']).toBeCloseTo(7000, 1);
    expect(extraFields['Throttle']).toBeCloseTo(50, 5); // 0.5 → 50%
    expect(extraFields['Gear']).toBe(3);
    expect(extraFields['Altitude (m)']).toBeCloseTo(620, 1);
    expect(extraFields['Lat G (Native)']).toBeCloseTo(1, 5); // 1g of LatAccel
    // GPS-derived primary g is computed too and coexists with the native channel.
    expect(extraFields).toHaveProperty('Lat G');
    expect(extraFields).toHaveProperty('Lon G');
  });

  it('derives startDate from the session start date', () => {
    const data = parseIracingFile(sampleIbt());
    expect(data.startDate?.getTime()).toBe(1_700_000_000 * 1000);
  });

  it('throws when no Lat/Lon channels are present', () => {
    const buf = makeIbt({
      records: 2,
      vars: [{ name: 'Speed', type: T_FLOAT, value: () => 10 }],
    });
    expect(() => parseIracingFile(buf)).toThrow(/Lat\/Lon/);
  });

  it('converts radian Lat/Lon when the unit says so', () => {
    const buf = makeIbt({
      records: 1,
      vars: [
        { name: 'Lat', type: T_DOUBLE, unit: 'rad', value: () => 0.633 },
        { name: 'Lon', type: T_DOUBLE, unit: 'rad', value: () => -2.007 },
      ],
    });
    const s0 = parseIracingFile(buf).samples[0];
    expect(s0.lat).toBeCloseTo(0.633 * (180 / Math.PI), 4);
    expect(s0.lon).toBeCloseTo(-2.007 * (180 / Math.PI), 4);
  });
});

// ─── Router integration: channels are canonicalized ─────────────────────────

describe('iRacing routing + channel normalization', () => {
  it('detects .ibt via parseDatalogContent and canonicalizes channel keys', () => {
    const data = parseDatalogContent(sampleIbt());
    const keys = Object.keys(data.samples[0].extraFields);
    // Canonical ids, not raw iRacing names.
    expect(keys).toContain('rpm');
    expect(keys).toContain('throttle');
    expect(keys).toContain('altitude');
    expect(keys).toContain('lat_g_native');
    expect(keys).toContain('lat_g');
    // Gear has no canonical id → custom slug.
    expect(keys).toContain('custom:gear');
  });
});
