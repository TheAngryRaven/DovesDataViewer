/**
 * iRacing telemetry (.ibt — iRacing Binary Telemetry) parser.
 *
 * iRacing's only native, on-disk telemetry export is the binary `.ibt` file the
 * sim writes (at the session tick rate, typically 60 Hz) once logging is armed
 * (Alt-L, or the always-on setting). It is the same data layout the live
 * shared-memory irsdk API serves; there is no built-in CSV/MoTeC export — those
 * are all third-party conversions of this file. We parse it directly so users
 * can drop the raw `.ibt` straight in.
 *
 * File layout (all little-endian; see the irsdk SDK `irsdk_defines.h`):
 *
 *   [irsdk_header        ] 112 bytes — versions, offsets, numVars, bufLen, varBuf[4]
 *   [irsdk_diskSubHeader ]  32 bytes — only present in .ibt: session start date +
 *                                      sessionRecordCount (number of data rows)
 *   [session info YAML   ] at header.sessionInfoOffset (static session metadata)
 *   [varHeader[numVars]  ] at header.varHeaderOffset — 144 bytes each: type,
 *                                      in-row offset, count, name/desc/unit strings
 *   [data records        ] at varBuf[0].bufOffset — sessionRecordCount rows of
 *                                      header.bufLen bytes; a channel's value sits
 *                                      at (rowBase + varHeader.offset), read by type
 *
 * GPS lat/lon (`Lat`/`Lon`, degrees) + `Speed` (m/s) make this a first-class GPS
 * source for the viewer; driver inputs, engine and native-g channels ride along
 * in extraFields.
 */

import { GpsSample, FieldMapping, ParsedData, ParserStats } from '@/types/racing';
import { applyGForceCalculations } from './gforceCalculation';
import {
  isTeleportation,
  MAX_SPEED_MPS,
  STANDARD_GRAVITY_MPS2,
  speedTriple,
  calculateBounds,
  validateGpsCoords,
  recordCoordRejection,
  createRejectedCounter,
} from './parserUtils';

// ─── Binary-format constants (irsdk_defines.h) ──────────────────────────────

const IRSDK_HEADER_SIZE = 112; // ver..bufLen (48) + pad1[2] (8) + varBuf[4] (4*16)
const IRSDK_DISK_SUBHEADER_SIZE = 32; // time_t(8) + 2 doubles(16) + 2 ints(8)
const VAR_HEADER_SIZE = 144; // type/offset/count/countAsTime+pad (16) + name(32)+desc(64)+unit(32)
const IRSDK_MAX_STRING = 32;

// irsdk_VarType → byte size. Index is the enum value stored in varHeader.type.
const VAR_TYPE_BYTES = [1, 1, 4, 4, 4, 8] as const; // char, bool, int, bitField, float, double

interface VarRef {
  type: number;
  offset: number; // byte offset of this channel within a data row
  count: number;
  unit: string;
}

/**
 * Optional iRacing channels mapped onto the viewer's canonical channel names.
 * `name` is a human display name that `channels.ts` resolves to a ChannelId
 * (e.g. "Water Temp" → water_temp) or, when unknown, becomes a `custom:` field.
 * `transform` converts iRacing's raw units into the viewer's expected ones.
 */
interface ChannelMap {
  /** iRacing variable name in the .ibt varHeader table. */
  irVar: string;
  /** Emitted display name (resolved to a canonical channel id where possible). */
  name: string;
  /** Optional unit hint for custom (non-canonical) channels. */
  unit?: string;
  transform?: (v: number) => number;
}

const RAD_TO_DEG = 180 / Math.PI;
const toPercent = (v: number) => v * 100; // iRacing inputs are 0..1 ratios
const toG = (v: number) => v / STANDARD_GRAVITY_MPS2; // m/s² → g

const OPTIONAL_CHANNELS: readonly ChannelMap[] = [
  { irVar: 'RPM', name: 'RPM' },
  { irVar: 'Throttle', name: 'Throttle', transform: toPercent },
  { irVar: 'Brake', name: 'Brake', transform: toPercent },
  { irVar: 'Clutch', name: 'Clutch', unit: '%', transform: toPercent },
  { irVar: 'Gear', name: 'Gear' },
  { irVar: 'SteeringWheelAngle', name: 'Steering Angle', unit: '°', transform: (v) => v * RAD_TO_DEG },
  { irVar: 'WaterTemp', name: 'Water Temp' },
  { irVar: 'OilTemp', name: 'Oil Temp' },
  // Native (logger-reported) g — coexists with the GPS-derived Lat G / Lon G.
  { irVar: 'LatAccel', name: 'Lat G (Native)', transform: toG },
  { irVar: 'LongAccel', name: 'Lon G (Native)', transform: toG },
  { irVar: 'YawRate', name: 'Yaw Rate', transform: (v) => v * RAD_TO_DEG },
  { irVar: 'FuelLevel', name: 'Fuel Level', unit: 'L' },
  { irVar: 'LapDistPct', name: 'Lap Dist %', unit: '%', transform: toPercent },
];

// ─── Low-level readers ──────────────────────────────────────────────────────

/** Read a fixed-length, null-terminated ASCII string from the buffer. */
function readCString(bytes: Uint8Array, start: number, maxLen: number): string {
  let end = start;
  const limit = Math.min(start + maxLen, bytes.length);
  while (end < limit && bytes[end] !== 0) end++;
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Read a single channel value from a data row, decoding per its irsdk type. */
function readVarValue(view: DataView, rowBase: number, v: VarRef): number {
  const at = rowBase + v.offset;
  switch (v.type) {
    case 0: return view.getInt8(at); // char
    case 1: return view.getUint8(at); // bool
    case 2: // int
    case 3: return view.getInt32(at, true); // bitField
    case 4: return view.getFloat32(at, true); // float
    case 5: return view.getFloat64(at, true); // double
    default: return NaN;
  }
}

// ─── Detection ──────────────────────────────────────────────────────────────

/**
 * Detect an iRacing .ibt by validating the binary header's internal
 * consistency (no magic bytes exist) and confirming the session-info block reads
 * as the iRacing YAML (it always contains a `WeekendInfo:` key).
 */
export function isIracingFormat(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < IRSDK_HEADER_SIZE + IRSDK_DISK_SUBHEADER_SIZE) return false;
  const view = new DataView(buffer);

  const ver = view.getInt32(0, true);
  const tickRate = view.getInt32(8, true);
  const sessionInfoLen = view.getInt32(16, true);
  const sessionInfoOffset = view.getInt32(20, true);
  const numVars = view.getInt32(24, true);
  const varHeaderOffset = view.getInt32(28, true);
  const numBuf = view.getInt32(32, true);
  const bufLen = view.getInt32(36, true);

  if (ver < 1 || ver > 16) return false;
  if (tickRate < 1 || tickRate > 1000) return false;
  if (numBuf < 1 || numBuf > 4) return false;
  if (numVars < 1 || numVars > 100000) return false;
  if (bufLen < 1 || bufLen > buffer.byteLength) return false;
  if (sessionInfoOffset < IRSDK_HEADER_SIZE || sessionInfoOffset >= buffer.byteLength) return false;
  if (varHeaderOffset < IRSDK_HEADER_SIZE || varHeaderOffset >= buffer.byteLength) return false;
  if (sessionInfoLen < 1) return false;

  // Strong confirmation: the session-info string is iRacing's YAML.
  const bytes = new Uint8Array(buffer);
  const probeLen = Math.min(sessionInfoLen, 512, buffer.byteLength - sessionInfoOffset);
  const probe = readCString(bytes, sessionInfoOffset, probeLen);
  return probe.includes('WeekendInfo');
}

// ─── Parse ──────────────────────────────────────────────────────────────────

export function parseIracingFile(buffer: ArrayBuffer): ParsedData {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const tickRate = view.getInt32(8, true);
  const numVars = view.getInt32(24, true);
  const varHeaderOffset = view.getInt32(28, true);
  const bufLen = view.getInt32(36, true);
  // varBuf[0] starts at byte 48: tickCount(@48), bufOffset(@52).
  const dataOffset = view.getInt32(52, true);

  // diskSubHeader immediately follows the 112-byte header in an .ibt file.
  const sessionStartDate = Number(view.getBigInt64(IRSDK_HEADER_SIZE, true)); // unix seconds (time_t)
  let recordCount = view.getInt32(IRSDK_HEADER_SIZE + 28, true); // sessionRecordCount

  // Index the variable headers by name.
  const vars = new Map<string, VarRef>();
  for (let i = 0; i < numVars; i++) {
    const vh = varHeaderOffset + i * VAR_HEADER_SIZE;
    if (vh + VAR_HEADER_SIZE > buffer.byteLength) break;
    const type = view.getInt32(vh, true);
    const offset = view.getInt32(vh + 4, true);
    const count = view.getInt32(vh + 8, true);
    const name = readCString(bytes, vh + 16, IRSDK_MAX_STRING);
    const unit = readCString(bytes, vh + 16 + IRSDK_MAX_STRING + 64, IRSDK_MAX_STRING);
    if (name) vars.set(name, { type, offset, count, unit });
  }

  const latVar = vars.get('Lat');
  const lonVar = vars.get('Lon');
  if (!latVar || !lonVar) {
    throw new Error('No GPS Lat/Lon channels found in iRacing .ibt file');
  }
  const speedVar = vars.get('Speed');
  const altVar = vars.get('Alt');
  const sessionTimeVar = vars.get('SessionTime');

  // Lat/Lon are degrees in modern .ibt; honor an explicit radians unit just in case.
  const latLonScale = latVar.unit.trim().toLowerCase() === 'rad' ? RAD_TO_DEG : 1;

  // Only keep optional channels actually present in this file.
  const presentChannels = OPTIONAL_CHANNELS.map((c) => ({ ...c, ref: vars.get(c.irVar) }))
    .filter((c): c is ChannelMap & { ref: VarRef } => Boolean(c.ref));

  // If the record count is missing/implausible, derive it from the data region.
  const maxRecords = Math.floor((buffer.byteLength - dataOffset) / bufLen);
  if (recordCount < 1 || recordCount > maxRecords) recordCount = maxRecords;

  const samples: GpsSample[] = [];
  const rejected = createRejectedCounter();
  let baseSessionTime: number | null = null;
  let totalRows = 0;

  for (let i = 0; i < recordCount; i++) {
    const rowBase = dataOffset + i * bufLen;
    if (rowBase + bufLen > buffer.byteLength) break;
    totalRows++;

    const lat = readVarValue(view, rowBase, latVar) * latLonScale;
    const lon = readVarValue(view, rowBase, lonVar) * latLonScale;

    const reason = validateGpsCoords(lat, lon);
    if (recordCoordRejection(rejected, reason)) continue;

    // Timebase: SessionTime is a steadily-increasing clock (seconds); fall back
    // to the tick index when it's somehow absent.
    let t: number;
    if (sessionTimeVar) {
      const st = readVarValue(view, rowBase, sessionTimeVar);
      if (baseSessionTime === null) baseSessionTime = st;
      t = (st - baseSessionTime) * 1000;
    } else {
      t = (i / tickRate) * 1000;
    }

    const speedMps = speedVar ? readVarValue(view, rowBase, speedVar) : 0;
    if (speedMps > MAX_SPEED_MPS) {
      rejected.speedCap++;
      continue;
    }

    if (samples.length > 0) {
      const prev = samples[samples.length - 1];
      if (isTeleportation(prev.lat, prev.lon, prev.t, lat, lon, t, 'iRacing')) {
        rejected.teleportation++;
        continue;
      }
    }

    const extraFields: Record<string, number> = {};
    if (altVar) {
      const alt = readVarValue(view, rowBase, altVar);
      if (!isNaN(alt)) extraFields['Altitude (m)'] = alt;
    }
    for (const c of presentChannels) {
      const raw = readVarValue(view, rowBase, c.ref);
      if (isNaN(raw)) continue;
      extraFields[c.name] = c.transform ? c.transform(raw) : raw;
    }

    samples.push({
      t,
      lat,
      lon,
      ...speedTriple(speedMps),
      extraFields,
    });
  }

  if (samples.length === 0) {
    throw new Error('No valid GPS samples found in iRacing .ibt file');
  }

  // GPS-derived primary g (coexists with the native Lat/Long-Accel channels).
  applyGForceCalculations(samples, 5);

  const fieldMappings: FieldMapping[] = [
    { index: -10, name: 'Lat G', enabled: true },
    { index: -11, name: 'Lon G', enabled: true },
  ];
  let idx = -1;
  if (altVar) fieldMappings.push({ index: idx--, name: 'Altitude (m)', enabled: true });
  for (const c of presentChannels) {
    fieldMappings.push({ index: idx--, name: c.name, unit: c.unit, enabled: true });
  }

  const parserStats: ParserStats = {
    totalRows,
    acceptedRows: samples.length,
    rejected,
  };

  const startDate = sessionStartDate > 0 ? new Date(sessionStartDate * 1000) : undefined;

  return {
    samples,
    fieldMappings,
    bounds: calculateBounds(samples),
    duration: samples[samples.length - 1].t,
    startDate,
    parserStats,
  };
}
