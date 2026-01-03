import { GpsSample, FieldMapping, ParsedData } from '@/types/racing';

/**
 * Dove CSV Parser
 * 
 * Simple CSV format with header row followed by data rows.
 * Uses Unix timestamps and speed in MPH.
 * 
 * Required columns: timestamp, sats, hdop, lat, lng, speed_mph, altitude_m
 * Optional columns: rpm, exhaust_temp_c, water_temp_c, and any others
 */

// Core required headers for Dove format
const DOVE_REQUIRED_HEADERS = ['timestamp', 'lat', 'lng', 'speed_mph'];

// Check if content is Dove CSV format
export function isDoveFormat(content: string): boolean {
  const lines = content.split(/\r?\n/);
  if (lines.length < 2) return false;
  
  const firstLine = lines[0].toLowerCase().trim();
  
  // Must have all required headers
  const hasRequiredHeaders = DOVE_REQUIRED_HEADERS.every(h => firstLine.includes(h));
  if (!hasRequiredHeaders) return false;
  
  // Check that second line has a Unix timestamp in milliseconds (13+ digit number)
  const secondLine = lines[1].trim();
  if (!secondLine) return false;
  
  const firstField = secondLine.split(',')[0];
  const timestamp = parseInt(firstField, 10);
  
  // Unix timestamps in milliseconds from 2020-2030 range: ~1577836800000 to ~1893456000000
  if (isNaN(timestamp) || timestamp < 1500000000000 || timestamp > 2000000000000) {
    return false;
  }
  
  // Make sure it's not another format
  if (firstLine.includes('[header]') || firstLine.includes('[data]')) {
    return false; // VBO format
  }
  if (firstLine.includes('gps_latitude') || firstLine.includes('gps_longitude')) {
    return false; // Alfano format
  }
  
  return true;
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

// Calculate bearing from one point to another
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  
  let bearing = Math.atan2(y, x) * 180 / Math.PI;
  if (bearing < 0) bearing += 360;
  return bearing;
}

// Calculate G-forces from GPS data
function calculateAccelerations(samples: GpsSample[]): void {
  const GRAVITY = 9.80665;
  const MAX_G = 3.0;
  const MIN_DT = 0.05;
  
  for (let i = 0; i < samples.length; i++) {
    const prevIdx = Math.max(0, i - 1);
    const nextIdx = Math.min(samples.length - 1, i + 1);
    
    const prev = samples[prevIdx];
    const curr = samples[i];
    const next = samples[nextIdx];
    
    const dt = (next.t - prev.t) / 1000;
    
    if (dt < MIN_DT) {
      curr.extraFields['Lat G'] = 0;
      curr.extraFields['Lon G'] = 0;
      continue;
    }
    
    // Longitudinal G from speed change
    const dv = next.speedMps - prev.speedMps;
    const lonG = (dv / dt) / GRAVITY;
    
    // Lateral G from heading change
    const dHeading = normalizeHeadingDelta(next.heading, prev.heading);
    const yawRate = (dHeading * Math.PI / 180) / dt;
    const latG = (curr.speedMps * yawRate) / GRAVITY;
    
    curr.extraFields['Lat G'] = clamp(latG, -MAX_G, MAX_G);
    curr.extraFields['Lon G'] = clamp(lonG, -MAX_G, MAX_G);
  }
}

// Apply moving average smoothing
function smoothField(samples: GpsSample[], fieldName: string, windowSize: number = 3): void {
  const halfWindow = Math.floor(windowSize / 2);
  const values = samples.map(s => s.extraFields[fieldName] ?? 0);
  
  for (let i = 0; i < samples.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - halfWindow; j <= i + halfWindow; j++) {
      if (j >= 0 && j < samples.length) {
        sum += values[j];
        count++;
      }
    }
    samples[i].extraFields[fieldName] = sum / count;
  }
}

// Convert column name to display name
function toDisplayName(columnName: string): string {
  return columnName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export function parseDoveFile(content: string): ParsedData {
  const lines = content.split(/\r?\n/);
  
  if (lines.length < 2) {
    throw new Error('Dove file must have header and data rows');
  }
  
  // Parse header row
  const headers = lines[0].toLowerCase().trim().split(',').map(h => h.trim());
  
  // Build column index map
  const columnIndex: Record<string, number> = {};
  headers.forEach((header, idx) => {
    columnIndex[header] = idx;
  });
  
  // Verify required columns
  for (const required of DOVE_REQUIRED_HEADERS) {
    if (columnIndex[required] === undefined) {
      throw new Error(`Missing required column: ${required}`);
    }
  }
  
  // Parse data rows
  const samples: GpsSample[] = [];
  let baseTimestamp: number | null = null;
  let startDate: Date | undefined;
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const fields = line.split(',').map(f => f.trim());
    if (fields.length < headers.length) continue;
    
    // Parse required fields
    const timestamp = parseInt(fields[columnIndex['timestamp']], 10);
    const lat = parseFloat(fields[columnIndex['lat']]);
    const lng = parseFloat(fields[columnIndex['lng']]);
    const speedMph = parseFloat(fields[columnIndex['speed_mph']]);
    
    // Validate required fields
    if (isNaN(timestamp) || isNaN(lat) || isNaN(lng) || isNaN(speedMph)) continue;
    if (lat === 0 && lng === 0) continue; // GPS error
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    
    // Set base timestamp and start date from first valid sample
    if (baseTimestamp === null) {
      baseTimestamp = timestamp;
      startDate = new Date(timestamp); // timestamp is already in milliseconds
    }
    
    // Convert to relative time in ms (timestamp is already in milliseconds)
    const t = timestamp - baseTimestamp;
    
    // Convert speed
    const speedMps = speedMph * 0.44704;
    const speedKph = speedMph * 1.60934;
    
    // Speed sanity check (150 m/s = ~335 mph)
    if (speedMps > 150) continue;
    
    // Teleportation filter
    if (samples.length > 0) {
      const prev = samples[samples.length - 1];
      const timeDiff = (t - prev.t) / 1000;
      if (timeDiff > 0 && timeDiff < 10) {
        const distance = haversineDistance(prev.lat, prev.lon, lat, lng);
        const maxDistance = 50 * (timeDiff / 0.04);
        if (distance > maxDistance && distance > 100) {
          console.warn(`Dove GPS teleportation: ${distance.toFixed(0)}m in ${timeDiff.toFixed(3)}s`);
          continue;
        }
      }
    }
    
    // Build extra fields
    const extraFields: Record<string, number> = {};
    
    // Optional standard columns
    if (columnIndex['sats'] !== undefined) {
      const sats = parseInt(fields[columnIndex['sats']], 10);
      if (!isNaN(sats)) extraFields['Satellites'] = sats;
    }
    
    if (columnIndex['hdop'] !== undefined) {
      const hdop = parseFloat(fields[columnIndex['hdop']]);
      if (!isNaN(hdop)) extraFields['HDOP'] = hdop;
    }
    
    if (columnIndex['altitude_m'] !== undefined) {
      const alt = parseFloat(fields[columnIndex['altitude_m']]);
      if (!isNaN(alt)) extraFields['Altitude'] = alt;
    }
    
    if (columnIndex['rpm'] !== undefined) {
      const rpm = parseFloat(fields[columnIndex['rpm']]);
      if (!isNaN(rpm) && rpm >= 0) extraFields['RPM'] = rpm;
    }
    
    if (columnIndex['exhaust_temp_c'] !== undefined) {
      const temp = parseFloat(fields[columnIndex['exhaust_temp_c']]);
      if (!isNaN(temp)) extraFields['EGT'] = temp;
    }
    
    if (columnIndex['water_temp_c'] !== undefined) {
      const temp = parseFloat(fields[columnIndex['water_temp_c']]);
      if (!isNaN(temp)) extraFields['Water Temp'] = temp;
    }
    
    // Handle any additional columns dynamically
    for (const header of headers) {
      if (columnIndex[header] !== undefined && 
          !['timestamp', 'sats', 'hdop', 'lat', 'lng', 'speed_mph', 'altitude_m', 'rpm', 'exhaust_temp_c', 'water_temp_c'].includes(header)) {
        const value = parseFloat(fields[columnIndex[header]]);
        if (!isNaN(value)) {
          extraFields[toDisplayName(header)] = value;
        }
      }
    }
    
    samples.push({
      t,
      lat,
      lon: lng,
      speedMps,
      speedMph,
      speedKph,
      extraFields
    });
  }
  
  if (samples.length === 0) {
    throw new Error('No valid GPS data found in Dove file');
  }
  
  // Calculate heading from GPS track
  for (let i = 0; i < samples.length; i++) {
    if (i < samples.length - 1) {
      const curr = samples[i];
      const next = samples[i + 1];
      curr.heading = calculateBearing(curr.lat, curr.lon, next.lat, next.lon);
    } else if (i > 0) {
      // Last sample uses previous heading
      samples[i].heading = samples[i - 1].heading;
    }
  }
  
  // Calculate GPS-derived G-forces
  calculateAccelerations(samples);
  smoothField(samples, 'Lat G', 5);
  smoothField(samples, 'Lon G', 5);
  
  // Build field mappings
  const fieldMappings: FieldMapping[] = [
    { index: -10, name: 'Lat G', enabled: true },
    { index: -11, name: 'Lon G', enabled: true },
  ];
  
  // Add optional fields if present
  const optionalFields = [
    { key: 'Satellites', index: -1 },
    { key: 'HDOP', index: -2 },
    { key: 'Altitude', index: -3 },
    { key: 'RPM', index: -20 },
    { key: 'EGT', index: -23 },
    { key: 'Water Temp', index: -24 },
  ];
  
  for (const field of optionalFields) {
    if (samples.some(s => s.extraFields[field.key] !== undefined)) {
      fieldMappings.push({ index: field.index, name: field.key, enabled: true });
    }
  }
  
  // Add any dynamic extra fields
  const knownFields = new Set(['Lat G', 'Lon G', 'Satellites', 'HDOP', 'Altitude', 'RPM', 'EGT', 'Water Temp']);
  let dynamicIndex = -100;
  
  for (const sample of samples) {
    for (const key of Object.keys(sample.extraFields)) {
      if (!knownFields.has(key) && !fieldMappings.some(f => f.name === key)) {
        fieldMappings.push({ index: dynamicIndex--, name: key, enabled: true });
        knownFields.add(key);
      }
    }
  }
  
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
