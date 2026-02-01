import { GpsSample, FieldMapping, ParsedData } from '@/types/racing';
import { applyGForceCalculations } from './gforceCalculation';

// UBX Protocol Constants
const UBX_SYNC_1 = 0xB5;
const UBX_SYNC_2 = 0x62;
const UBX_NAV_CLASS = 0x01;
const UBX_NAV_PVT = 0x07;
const NAV_PVT_LENGTH = 92;

interface NavPvtData {
  year: number;
  month: number;
  day: number;
  hour: number;
  min: number;
  sec: number;
  nano: number; // nanoseconds
  fixType: number;
  flags: number;
  numSV: number; // satellites
  lon: number; // degrees (scaled from 1e-7)
  lat: number; // degrees (scaled from 1e-7)
  height: number; // mm above ellipsoid
  hMSL: number; // mm above mean sea level
  hAcc: number; // mm horizontal accuracy
  vAcc: number; // mm vertical accuracy
  velN: number; // mm/s north velocity
  velE: number; // mm/s east velocity
  velD: number; // mm/s down velocity
  gSpeed: number; // mm/s ground speed
  headMot: number; // degrees (scaled from 1e-5), heading of motion
  sAcc: number; // mm/s speed accuracy
  headAcc: number; // degrees (scaled from 1e-5), heading accuracy
  pDOP: number; // scaled from 0.01
  headVeh: number; // degrees (scaled from 1e-5), heading of vehicle
}

// Calculate UBX checksum (Fletcher-8)
function calculateChecksum(data: Uint8Array, start: number, length: number): { ckA: number; ckB: number } {
  let ckA = 0;
  let ckB = 0;
  for (let i = 0; i < length; i++) {
    ckA = (ckA + data[start + i]) & 0xFF;
    ckB = (ckB + ckA) & 0xFF;
  }
  return { ckA, ckB };
}

// Find next UBX message in buffer
function findNextUbxMessage(data: Uint8Array, offset: number): { 
  classId: number; 
  msgId: number; 
  payload: DataView;
  nextOffset: number;
} | null {
  // Search for sync bytes
  while (offset < data.length - 8) {
    if (data[offset] === UBX_SYNC_1 && data[offset + 1] === UBX_SYNC_2) {
      const classId = data[offset + 2];
      const msgId = data[offset + 3];
      const length = data[offset + 4] | (data[offset + 5] << 8);
      
      // Check if we have enough data
      if (offset + 6 + length + 2 > data.length) {
        return null;
      }
      
      // Verify checksum
      const { ckA, ckB } = calculateChecksum(data, offset + 2, length + 4);
      const msgCkA = data[offset + 6 + length];
      const msgCkB = data[offset + 6 + length + 1];
      
      if (ckA === msgCkA && ckB === msgCkB) {
        const payload = new DataView(data.buffer, data.byteOffset + offset + 6, length);
        return {
          classId,
          msgId,
          payload,
          nextOffset: offset + 6 + length + 2
        };
      } else {
        // Bad checksum, move forward
        offset++;
        continue;
      }
    }
    offset++;
  }
  return null;
}

// Parse NAV-PVT message payload
function parseNavPvt(payload: DataView): NavPvtData | null {
  if (payload.byteLength < NAV_PVT_LENGTH) return null;
  
  // Parse all fields from the 92-byte NAV-PVT message
  const year = payload.getUint16(4, true);
  const month = payload.getUint8(6);
  const day = payload.getUint8(7);
  const hour = payload.getUint8(8);
  const min = payload.getUint8(9);
  const sec = payload.getUint8(10);
  const valid = payload.getUint8(11);
  const tAcc = payload.getUint32(12, true);
  const nano = payload.getInt32(16, true);
  const fixType = payload.getUint8(20);
  const flags = payload.getUint8(21);
  const flags2 = payload.getUint8(22);
  const numSV = payload.getUint8(23);
  
  // Position
  const lon = payload.getInt32(24, true) * 1e-7; // degrees
  const lat = payload.getInt32(28, true) * 1e-7; // degrees
  const height = payload.getInt32(32, true); // mm
  const hMSL = payload.getInt32(36, true); // mm
  const hAcc = payload.getUint32(40, true); // mm
  const vAcc = payload.getUint32(44, true); // mm
  
  // Velocity
  const velN = payload.getInt32(48, true); // mm/s
  const velE = payload.getInt32(52, true); // mm/s
  const velD = payload.getInt32(56, true); // mm/s
  const gSpeed = payload.getInt32(60, true); // mm/s
  const headMot = payload.getInt32(64, true) * 1e-5; // degrees
  const sAcc = payload.getUint32(68, true); // mm/s
  const headAcc = payload.getUint32(72, true) * 1e-5; // degrees
  const pDOP = payload.getUint16(76, true) * 0.01;
  
  // flags3 at 78-79, reserved at 80-83
  const headVeh = payload.getInt32(84, true) * 1e-5; // degrees
  
  // Only accept valid fixes (3D fix = 3, GNSS+DR = 4)
  if (fixType < 2) return null;
  
  // Check if position and time are valid
  const validTime = (valid & 0x01) !== 0;
  const validDate = (valid & 0x02) !== 0;
  
  if (!validTime || !validDate) return null;
  
  return {
    year, month, day, hour, min, sec, nano,
    fixType, flags, numSV,
    lon, lat, height, hMSL, hAcc, vAcc,
    velN, velE, velD, gSpeed, headMot,
    sAcc, headAcc, pDOP, headVeh
  };
}

// Clamp value to range
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Normalize heading delta to handle wrap-around
function normalizeHeadingDelta(h2: number | undefined, h1: number | undefined): number {
  if (h2 === undefined || h1 === undefined) return 0;
  let delta = h2 - h1;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}


// Haversine distance in meters
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function parseUbxFile(buffer: ArrayBuffer): ParsedData {
  const data = new Uint8Array(buffer);
  const samples: GpsSample[] = [];
  
  let offset = 0;
  let baseTimeMs: number | null = null;
  let startDate: Date | undefined;
  
  while (offset < data.length) {
    const msg = findNextUbxMessage(data, offset);
    if (!msg) break;
    
    offset = msg.nextOffset;
    
    // Only process NAV-PVT messages
    if (msg.classId !== UBX_NAV_CLASS || msg.msgId !== UBX_NAV_PVT) {
      continue;
    }
    
    const pvt = parseNavPvt(msg.payload);
    if (!pvt) continue;
    
    // Skip invalid positions (0,0 is a common GPS error)
    if (pvt.lat === 0 || pvt.lon === 0) continue;
    
    // Calculate time in ms since midnight
    const timeMs = (pvt.hour * 3600 + pvt.min * 60 + pvt.sec) * 1000 + Math.floor(pvt.nano / 1e6);
    
    // Set base time and start date from first valid sample
    if (baseTimeMs === null) {
      baseTimeMs = timeMs;
      startDate = new Date(pvt.year, pvt.month - 1, pvt.day, pvt.hour, pvt.min, pvt.sec);
    }
    
    // Calculate relative time (handle midnight wrap)
    let t = timeMs - baseTimeMs;
    if (t < 0) t += 86400000; // Add 24 hours if wrapped
    
    // Convert speed from mm/s to m/s
    const speedMps = pvt.gSpeed / 1000;
    
    // Sanity check on speed (max 150 m/s = ~335 mph)
    if (speedMps > 150) continue;
    
    // Teleportation filter
    if (samples.length > 0) {
      const prev = samples[samples.length - 1];
      const timeDiff = (t - prev.t) / 1000;
      if (timeDiff > 0 && timeDiff < 10) {
        const distance = haversineDistance(prev.lat, prev.lon, pvt.lat, pvt.lon);
        const maxDistance = 50 * (timeDiff / 0.04);
        if (distance > maxDistance && distance > 100) {
          console.warn(`UBX GPS teleportation: ${distance.toFixed(0)}m in ${timeDiff.toFixed(3)}s`);
          continue;
        }
      }
    }
    
    // Normalize heading to 0-360
    let heading = pvt.headMot;
    if (heading < 0) heading += 360;
    if (heading >= 360) heading -= 360;
    
    const extraFields: Record<string, number> = {
      'Satellites': pvt.numSV,
      'HDOP': pvt.pDOP, // pDOP is close enough for display purposes
      'Altitude (m)': pvt.hMSL / 1000, // Convert mm to m
      'H Accuracy (m)': pvt.hAcc / 1000,
      'V Accuracy (m)': pvt.vAcc / 1000,
      'Speed Acc (m/s)': pvt.sAcc / 1000,
    };
    
    samples.push({
      t,
      lat: pvt.lat,
      lon: pvt.lon,
      speedMps,
      speedMph: speedMps * 2.23694,
      speedKph: speedMps * 3.6,
      heading,
      extraFields
    });
  }
  
  if (samples.length === 0) {
    throw new Error('No valid NAV-PVT messages found in UBX file');
  }
  
  // Calculate G-forces
  applyGForceCalculations(samples, 5);
  
  // Build field mappings
  const fieldMappings: FieldMapping[] = [
    { index: -10, name: 'Lat G', enabled: true },
    { index: -11, name: 'Lon G', enabled: true },
    { index: -1, name: 'Satellites', enabled: true },
    { index: -2, name: 'HDOP', enabled: true },
    { index: -3, name: 'Altitude (m)', enabled: true },
    { index: -4, name: 'H Accuracy (m)', enabled: true },
    { index: -5, name: 'V Accuracy (m)', enabled: true },
    { index: -6, name: 'Speed Acc (m/s)', enabled: true },
  ];
  
  // Calculate bounds
  const lats = samples.map(s => s.lat);
  const lons = samples.map(s => s.lon);
  
  return {
    samples,
    fieldMappings,
    bounds: {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons)
    },
    duration: samples[samples.length - 1].t,
    startDate
  };
}

// Check if buffer starts with UBX sync bytes
export function isUbxFormat(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 2) return false;
  const data = new Uint8Array(buffer);
  
  // Check first few hundred bytes for UBX sync pattern
  for (let i = 0; i < Math.min(200, data.length - 1); i++) {
    if (data[i] === UBX_SYNC_1 && data[i + 1] === UBX_SYNC_2) {
      return true;
    }
  }
  return false;
}
