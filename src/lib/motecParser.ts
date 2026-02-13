import { ParsedData, GpsSample, FieldMapping } from '@/types/racing';
import { applyGForceCalculations } from './gforceCalculation';
import { clamp, haversineDistance } from './parserUtils';

/**
 * MoTeC Parser — supports both:
 * 1. MoTeC CSV exports from i2 Pro (quoted CSV with metadata header)
 * 2. MoTeC .ld binary files (native data logger format)
 *
 * Based on reverse-engineered format from gotzl/ldparser (GPL-3.0).
 */

// ─── CSV helpers ───────────────────────────────────────────────

function parseQuotedCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

// ─── MoTeC CSV format detection ────────────────────────────────

const MOTEC_CSV_INDICATORS = [
  /^"?sample\s*rate"?/i,
  /^"?beacon\s*markers?"?/i,
  /^"?log\s*date"?/i,
  /^"?log\s*time"?/i,
  /^"?device"?\s*,/i,
  /^"?driver"?\s*,/i,
];

export function isMotecCsvFormat(content: string): boolean {
  const lines = content.split(/\r?\n/).slice(0, 20);
  let hits = 0;
  for (const line of lines) {
    for (const pat of MOTEC_CSV_INDICATORS) {
      if (pat.test(line)) hits++;
    }
  }
  // Need at least 3 MoTeC-specific header lines
  return hits >= 3;
}

// ─── MoTeC CSV parser ─────────────────────────────────────────

export function parseMotecCsvFile(content: string): ParsedData {
  const lines = content.split(/\r?\n/);

  // Scan header block for metadata
  let sampleRateHz = 0;
  let headerEndIdx = -1;

  for (let i = 0; i < Math.min(30, lines.length); i++) {
    const fields = parseQuotedCsvLine(lines[i]);
    const key = fields[0]?.toLowerCase();

    if (key === 'sample rate') {
      sampleRateHz = parseFloat(fields[1]) || 0;
    }

    // Detect channel names row: look for "Time" as first column
    if (key === 'time' && fields.length >= 2) {
      headerEndIdx = i;
      break;
    }
  }

  if (headerEndIdx === -1) {
    throw new Error('Could not find MoTeC CSV channel header row');
  }

  const channelNames = parseQuotedCsvLine(lines[headerEndIdx]).map(n => n.toLowerCase().trim());

  // Next line should be units
  const unitsIdx = headerEndIdx + 1;
  const units = unitsIdx < lines.length ? parseQuotedCsvLine(lines[unitsIdx]) : [];

  // Data starts after units row
  const dataStartIdx = unitsIdx + 1;

  // Map columns
  const findCol = (...names: string[]) => {
    for (const name of names) {
      const idx = channelNames.indexOf(name);
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const timeCol = findCol('time', 't');
  const latCol = findCol('gps latitude', 'gps_latitude', 'latitude', 'lat');
  const lonCol = findCol('gps longitude', 'gps_longitude', 'longitude', 'lon', 'long');
  const speedCol = findCol('ground speed', 'gps speed', 'speed', 'gps_speed');
  const headingCol = findCol('gps heading', 'gps_heading', 'heading', 'course', 'gps course');
  const rpmCol = findCol('engine rpm', 'rpm', 'engine_rpm');
  const latGCol = findCol('g force lat', 'g_force_lat', 'lateral g', 'lat g', 'gy');
  const lonGCol = findCol('g force long', 'g_force_long', 'longitudinal g', 'lon g', 'gx');
  const throttleCol = findCol('throttle', 'throttle pos', 'tps');
  const waterTempCol = findCol('water temp', 'coolant temp', 't_h2o', 'engine temp');
  const altCol = findCol('gps altitude', 'altitude', 'alt');

  if (latCol === -1 || lonCol === -1) {
    throw new Error('MoTeC CSV missing GPS Latitude/Longitude channels');
  }

  // Detect speed unit
  const speedUnit = (units[speedCol] || '').toLowerCase();
  const speedToMps = speedUnit.includes('mph') ? 0.44704 : (speedUnit.includes('m/s') ? 1 : 1 / 3.6);

  const samples: GpsSample[] = [];
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  let prevSample: GpsSample | null = null;

  for (let i = dataStartIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = parseQuotedCsvLine(line);

    const lat = parseFloat(vals[latCol]);
    const lon = parseFloat(vals[lonCol]);
    if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

    let timeMs = 0;
    if (timeCol >= 0) {
      const tv = parseFloat(vals[timeCol]);
      if (!isNaN(tv)) timeMs = tv * 1000; // MoTeC CSV time is in seconds
    }

    let speedMps = 0;
    if (speedCol >= 0) {
      const sv = parseFloat(vals[speedCol]);
      if (!isNaN(sv)) speedMps = sv * speedToMps;
    }

    // Teleportation filter
    if (prevSample) {
      const dt = (timeMs - prevSample.t) / 1000;
      if (dt > 0) {
        const dist = haversineDistance(prevSample.lat, prevSample.lon, lat, lon);
        if (dist / dt > 100) continue;
      }
    }

    const extraFields: Record<string, number> = {};
    const tryExtra = (col: number, name: string, transform?: (v: number) => number) => {
      if (col < 0) return;
      const v = parseFloat(vals[col]);
      if (!isNaN(v)) extraFields[name] = transform ? transform(v) : v;
    };

    tryExtra(rpmCol, 'RPM');
    tryExtra(throttleCol, 'Throttle');
    tryExtra(waterTempCol, 'Water Temp');
    tryExtra(altCol, 'Altitude');
    tryExtra(latGCol, 'Lat G', v => clamp(Math.abs(v) > 5 ? v / 9.81 : v, -5, 5));
    tryExtra(lonGCol, 'Lon G', v => clamp(Math.abs(v) > 5 ? v / 9.81 : v, -5, 5));

    let heading: number | undefined;
    if (headingCol >= 0) {
      const h = parseFloat(vals[headingCol]);
      if (!isNaN(h)) heading = h;
    }

    const sample: GpsSample = {
      t: timeMs, lat, lon, speedMps,
      speedMph: speedMps * 2.23694,
      speedKph: speedMps * 3.6,
      heading, extraFields,
    };

    samples.push(sample);
    prevSample = sample;
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
  }

  if (samples.length === 0) throw new Error('No valid GPS samples found in MoTeC CSV');

  // Fill G-forces from GPS if not native
  if (!samples.some(s => 'Lat G' in s.extraFields)) {
    applyGForceCalculations(samples, 5);
  }

  const fieldNames = new Set<string>();
  samples.forEach(s => Object.keys(s.extraFields).forEach(k => fieldNames.add(k)));

  return {
    samples,
    fieldMappings: Array.from(fieldNames).map((name, idx) => ({ index: idx, name, enabled: true })),
    bounds: { minLat, maxLat, minLon, maxLon },
    duration: samples.length > 0 ? samples[samples.length - 1].t : 0,
  };
}

// ─── MoTeC LD binary format ───────────────────────────────────

// LD file magic marker at offset 0
const LD_MARKER = 0x40;

// Header struct layout (little-endian):
// I4x II 20x I 24x HHH I 8s H H I 4x 16s 16x 16s 16x 64s 64s 64x 64s 64x 1024x I 66x 64s 126x
const HEAD_SIZE = 1594; // from Python struct.calcsize

// Channel meta struct layout:
// IIII H HHH hhhh 32s 8s 12s 40x
const CHAN_META_SIZE = 128; // 4*4 + 2 + 2*3 + 2*4 + 32 + 8 + 12 + 40 = 128

export function isMotecLdFormat(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < HEAD_SIZE) return false;
  const view = new DataView(buffer);
  const marker = view.getUint32(0, true);
  return marker === LD_MARKER;
}

function decodeAscii(buffer: ArrayBuffer, offset: number, length: number): string {
  const bytes = new Uint8Array(buffer, offset, length);
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) break;
    result += String.fromCharCode(bytes[i]);
  }
  return result.trim();
}

interface LdChannel {
  name: string;
  shortName: string;
  unit: string;
  freq: number;
  dataPtr: number;
  dataLen: number;
  dtypeA: number;
  dtypeB: number;
  shift: number;
  mul: number;
  scale: number;
  dec: number;
  nextMetaPtr: number;
}

function readChannelMeta(view: DataView, buffer: ArrayBuffer, metaPtr: number): LdChannel {
  let o = metaPtr;
  const _prevAddr = view.getUint32(o, true); o += 4;
  const nextMetaPtr = view.getUint32(o, true); o += 4;
  const dataPtr = view.getUint32(o, true); o += 4;
  const dataLen = view.getUint32(o, true); o += 4;
  const _counter = view.getUint16(o, true); o += 2;
  const dtypeA = view.getUint16(o, true); o += 2;
  const dtypeB = view.getUint16(o, true); o += 2;
  const freq = view.getUint16(o, true); o += 2;
  const shift = view.getInt16(o, true); o += 2;
  const mul = view.getInt16(o, true); o += 2;
  const scale = view.getInt16(o, true); o += 2;
  const dec = view.getInt16(o, true); o += 2;

  const name = decodeAscii(buffer, o, 32); o += 32;
  const shortName = decodeAscii(buffer, o, 8); o += 8;
  const unit = decodeAscii(buffer, o, 12);

  return { name, shortName, unit, freq, dataPtr, dataLen, dtypeA, dtypeB, shift, mul, scale, dec, nextMetaPtr };
}

function readChannelData(view: DataView, ch: LdChannel): Float64Array {
  // Determine data type size
  let bytesPerSample: number;
  let readSample: (offset: number) => number;

  if (ch.dtypeA === 0x07) {
    // Float types
    if (ch.dtypeB === 4) { bytesPerSample = 4; readSample = o => view.getFloat32(o, true); }
    else if (ch.dtypeB === 2) {
      // float16 — manual decode
      bytesPerSample = 2;
      readSample = o => {
        const bits = view.getUint16(o, true);
        const sign = (bits >> 15) ? -1 : 1;
        const exp = (bits >> 10) & 0x1f;
        const frac = bits & 0x3ff;
        if (exp === 0) return sign * Math.pow(2, -14) * (frac / 1024);
        if (exp === 0x1f) return frac ? NaN : sign * Infinity;
        return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
      };
    } else { return new Float64Array(0); }
  } else if (ch.dtypeA === 0x03 || ch.dtypeA === 0x05 || ch.dtypeA === 0x00) {
    // Integer types
    if (ch.dtypeB === 4) { bytesPerSample = 4; readSample = o => view.getInt32(o, true); }
    else if (ch.dtypeB === 2) { bytesPerSample = 2; readSample = o => view.getInt16(o, true); }
    else { return new Float64Array(0); }
  } else {
    return new Float64Array(0);
  }

  const count = Math.min(ch.dataLen, Math.floor((view.byteLength - ch.dataPtr) / bytesPerSample));
  const data = new Float64Array(count);

  const scaleFactor = ch.scale !== 0 ? ch.scale : 1;
  const mulFactor = ch.mul !== 0 ? ch.mul : 1;
  const decFactor = Math.pow(10, -ch.dec);

  for (let i = 0; i < count; i++) {
    const raw = readSample(ch.dataPtr + i * bytesPerSample);
    data[i] = (raw / scaleFactor * decFactor + ch.shift) * mulFactor;
  }

  return data;
}

export function parseMotecLdFile(buffer: ArrayBuffer): ParsedData {
  const view = new DataView(buffer);

  // Read header
  let o = 4; // skip marker
  o += 4; // padding
  const metaPtr = view.getUint32(o, true); o += 4;
  const _dataPtr = view.getUint32(o, true); // o += 4; not needed for further reads

  // Walk channel linked list
  const channels: LdChannel[] = [];
  let ptr = metaPtr;
  const visited = new Set<number>();
  while (ptr > 0 && !visited.has(ptr) && ptr + CHAN_META_SIZE <= buffer.byteLength) {
    visited.add(ptr);
    try {
      const ch = readChannelMeta(view, buffer, ptr);
      channels.push(ch);
      ptr = ch.nextMetaPtr;
    } catch {
      break;
    }
  }

  if (channels.length === 0) {
    throw new Error('No channels found in MoTeC LD file');
  }

  // Read all channel data
  const channelData = new Map<string, { data: Float64Array; freq: number; unit: string }>();
  for (const ch of channels) {
    const data = readChannelData(view, ch);
    if (data.length > 0) {
      channelData.set(ch.name.toLowerCase(), { data, freq: ch.freq, unit: ch.unit });
      // Also store by short name as fallback
      if (ch.shortName) {
        channelData.set(ch.shortName.toLowerCase(), { data, freq: ch.freq, unit: ch.unit });
      }
    }
  }

  // Find GPS channels
  const findChannel = (...names: string[]) => {
    for (const n of names) {
      const ch = channelData.get(n.toLowerCase());
      if (ch && ch.data.length > 0) return ch;
    }
    return null;
  };

  const latCh = findChannel('GPS Latitude', 'GPS_Latitude', 'Latitude', 'Lat', 'GPS Lat');
  const lonCh = findChannel('GPS Longitude', 'GPS_Longitude', 'Longitude', 'Lon', 'Long', 'GPS Long');

  if (!latCh || !lonCh) {
    throw new Error('MoTeC LD file missing GPS Latitude/Longitude channels');
  }

  const speedCh = findChannel('Ground Speed', 'GPS Speed', 'Speed', 'GPS_Speed');
  const headingCh = findChannel('GPS Heading', 'Heading', 'GPS_Heading', 'Course', 'GPS Course');
  const rpmCh = findChannel('Engine RPM', 'RPM', 'Engine_RPM');
  const latGCh = findChannel('G Force Lat', 'G_Force_Lat', 'Lateral G', 'Lat G');
  const lonGCh = findChannel('G Force Long', 'G_Force_Long', 'Longitudinal G', 'Lon G');
  const throttleCh = findChannel('Throttle', 'Throttle Pos', 'TPS');
  const waterTempCh = findChannel('Water Temp', 'Coolant Temp', 'Engine Temp');
  const altCh = findChannel('GPS Altitude', 'Altitude', 'Alt');

  // Use GPS channel frequency as base
  const baseFreq = latCh.freq || 10;
  const nSamples = Math.min(latCh.data.length, lonCh.data.length);

  // Resample helper: nearest-neighbor to base frequency
  const resample = (ch: { data: Float64Array; freq: number } | null, idx: number): number | undefined => {
    if (!ch) return undefined;
    const srcIdx = Math.round(idx * ch.freq / baseFreq);
    if (srcIdx < 0 || srcIdx >= ch.data.length) return undefined;
    return ch.data[srcIdx];
  };

  // Detect speed unit
  const speedUnit = speedCh?.unit?.toLowerCase() || '';
  const speedToMps = speedUnit.includes('mph') ? 0.44704 : (speedUnit.includes('m/s') ? 1 : 1 / 3.6);

  const samples: GpsSample[] = [];
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  let prevSample: GpsSample | null = null;

  for (let i = 0; i < nSamples; i++) {
    const lat = latCh.data[i];
    const lon = lonCh.data[i];
    if (lat === 0 || lon === 0 || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

    const timeMs = (i / baseFreq) * 1000;

    const rawSpeed = resample(speedCh, i);
    const speedMps = rawSpeed !== undefined ? rawSpeed * speedToMps : 0;

    // Teleportation filter
    if (prevSample) {
      const dt = (timeMs - prevSample.t) / 1000;
      if (dt > 0) {
        const dist = haversineDistance(prevSample.lat, prevSample.lon, lat, lon);
        if (dist / dt > 100) continue;
      }
    }

    const extraFields: Record<string, number> = {};
    const tryExtra = (ch: { data: Float64Array; freq: number } | null, name: string, transform?: (v: number) => number) => {
      const v = resample(ch, i);
      if (v !== undefined && !isNaN(v)) extraFields[name] = transform ? transform(v) : v;
    };

    tryExtra(rpmCh, 'RPM');
    tryExtra(throttleCh, 'Throttle');
    tryExtra(waterTempCh, 'Water Temp');
    tryExtra(altCh, 'Altitude');
    tryExtra(latGCh, 'Lat G', v => clamp(Math.abs(v) > 5 ? v / 9.81 : v, -5, 5));
    tryExtra(lonGCh, 'Lon G', v => clamp(Math.abs(v) > 5 ? v / 9.81 : v, -5, 5));

    const rawHeading = resample(headingCh, i);
    const heading = rawHeading !== undefined && !isNaN(rawHeading) ? rawHeading : undefined;

    const sample: GpsSample = {
      t: timeMs, lat, lon, speedMps,
      speedMph: speedMps * 2.23694,
      speedKph: speedMps * 3.6,
      heading, extraFields,
    };

    samples.push(sample);
    prevSample = sample;
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
  }

  if (samples.length === 0) throw new Error('No valid GPS samples found in MoTeC LD file');

  if (!samples.some(s => 'Lat G' in s.extraFields)) {
    applyGForceCalculations(samples, 5);
  }

  // Collect extra channels not already mapped
  const fieldNames = new Set<string>();
  samples.forEach(s => Object.keys(s.extraFields).forEach(k => fieldNames.add(k)));

  return {
    samples,
    fieldMappings: Array.from(fieldNames).map((name, idx) => ({ index: idx, name, enabled: true })),
    bounds: { minLat, maxLat, minLon, maxLon },
    duration: samples.length > 0 ? samples[samples.length - 1].t : 0,
  };
}
