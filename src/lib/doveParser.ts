import { GpsSample, FieldMapping, ParsedData, ParserStats } from '@/types/racing';
import { applyGForceCalculations } from './gforceCalculation';
import { haversineDistance, calculateBearing, isTeleportation, MAX_SPEED_MPS } from './parserUtils';

/**
 * Dove CSV Parser
 *
 * Simple CSV format with header row followed by data rows.
 * Uses Unix timestamps and speed in MPH.
 *
 * Required columns: timestamp, sats, hdop, lat, lng, speed_mph
 * Optional columns: altitude_m, heading_deg, h_acc_m, rpm, accel_x, accel_y, accel_z,
 *                   exhaust_temp_c, water_temp_c, and any others
 */

// Core required headers for Dove format
const DOVE_REQUIRED_HEADERS = ['timestamp', 'lat', 'lng', 'speed_mph'];

// All known Dove columns (excluded from dynamic field detection)
const DOVE_KNOWN_COLUMNS = new Set([
  'timestamp', 'sats', 'hdop', 'lat', 'lng', 'speed_mph', 'altitude_m',
  'heading_deg', 'h_acc_m', 'rpm', 'exhaust_temp_c', 'water_temp_c',
  'accel_x', 'accel_y', 'accel_z',
]);

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
  
  // Unix timestamps in milliseconds from 2020-2030 range
  if (isNaN(timestamp) || timestamp < 1500000000000 || timestamp > 2000000000000) {
    return false;
  }
  
  // Make sure it's not another format
  if (firstLine.includes('[header]') || firstLine.includes('[data]')) return false;
  if (firstLine.includes('gps_latitude') || firstLine.includes('gps_longitude')) return false;
  
  return true;
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
  
  const hasHeadingColumn = columnIndex['heading_deg'] !== undefined;
  
  // Parse data rows
  const samples: GpsSample[] = [];
  let baseTimestamp: number | null = null;
  let startDate: Date | undefined;
  
  const rejected = {
    nanFields: 0,
    zeroCoords: 0,
    outOfRange: 0,
    speedCap: 0,
    teleportation: 0,
    incompleteRow: 0,
  };
  let totalRows = 0;
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    totalRows++;
    
    const fields = line.split(',').map(f => f.trim());
    if (fields.length < headers.length) { rejected.incompleteRow++; continue; }
    
    // Parse required fields
    const timestamp = parseInt(fields[columnIndex['timestamp']], 10);
    const lat = parseFloat(fields[columnIndex['lat']]);
    const lng = parseFloat(fields[columnIndex['lng']]);
    const speedMph = parseFloat(fields[columnIndex['speed_mph']]);
    
    // Validate required fields
    if (isNaN(timestamp) || isNaN(lat) || isNaN(lng) || isNaN(speedMph)) { rejected.nanFields++; continue; }
    if (lat === 0 && lng === 0) { rejected.zeroCoords++; continue; }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) { rejected.outOfRange++; continue; }
    
    // Set base timestamp and start date from first valid sample
    if (baseTimestamp === null) {
      baseTimestamp = timestamp;
      startDate = new Date(timestamp);
    }
    
    const t = timestamp - baseTimestamp;
    
    // Convert speed
    const speedMps = speedMph * 0.44704;
    const speedKph = speedMph * 1.60934;
    
    if (speedMps > MAX_SPEED_MPS) { rejected.speedCap++; continue; }

    // Teleportation filter
    if (samples.length > 0) {
      const prev = samples[samples.length - 1];
      if (isTeleportation(prev.lat, prev.lon, prev.t, lat, lng, t, 'Dove')) { rejected.teleportation++; continue; }
    }
    
    // Build extra fields
    const extraFields: Record<string, number> = {};
    
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
    
    if (columnIndex['h_acc_m'] !== undefined) {
      const hAcc = parseFloat(fields[columnIndex['h_acc_m']]);
      if (!isNaN(hAcc)) extraFields['H Accuracy'] = hAcc;
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
    
    if (columnIndex['accel_x'] !== undefined) {
      const ax = parseFloat(fields[columnIndex['accel_x']]);
      if (!isNaN(ax)) extraFields['Accel X'] = ax;
    }
    
    if (columnIndex['accel_y'] !== undefined) {
      const ay = parseFloat(fields[columnIndex['accel_y']]);
      if (!isNaN(ay)) extraFields['Accel Y'] = ay;
    }
    
    if (columnIndex['accel_z'] !== undefined) {
      const az = parseFloat(fields[columnIndex['accel_z']]);
      if (!isNaN(az)) extraFields['Accel Z'] = az;
    }
    
    // Handle any additional columns dynamically
    for (const header of headers) {
      if (!DOVE_KNOWN_COLUMNS.has(header)) {
        const value = parseFloat(fields[columnIndex[header]]);
        if (!isNaN(value)) {
          extraFields[toDisplayName(header)] = value;
        }
      }
    }
    
    // Parse heading from CSV if available
    let heading: number | undefined;
    if (hasHeadingColumn) {
      const h = parseFloat(fields[columnIndex['heading_deg']]);
      if (!isNaN(h) && h >= 0 && h <= 360) heading = h;
    }
    
    samples.push({
      t, lat, lon: lng,
      speedMps, speedMph, speedKph,
      heading,
      extraFields
    });
  }
  
  if (samples.length === 0) {
    throw new Error('No valid GPS data found in Dove file');
  }
  
  // Calculate heading from GPS track only if not provided in CSV
  if (!hasHeadingColumn) {
    for (let i = 0; i < samples.length; i++) {
      if (i < samples.length - 1) {
        const curr = samples[i];
        const next = samples[i + 1];
        curr.heading = calculateBearing(curr.lat, curr.lon, next.lat, next.lon);
      } else if (i > 0) {
        samples[i].heading = samples[i - 1].heading;
      }
    }
  }
  
  // Always calculate GPS-derived G-forces (even when HW accel is present)
  const hasHardwareAccel = samples.some(s => s.extraFields['Accel X'] !== undefined);
  applyGForceCalculations(samples, 5);
  
  // Build field mappings
  const fieldMappings: FieldMapping[] = [];
  
  // Hardware accelerometer fields first if present
  if (hasHardwareAccel) {
    fieldMappings.push(
      { index: -30, name: 'Accel X', unit: 'G', enabled: true },
      { index: -31, name: 'Accel Y', unit: 'G', enabled: true },
      { index: -32, name: 'Accel Z', unit: 'G', enabled: true },
    );
  }
  
  // GPS-derived G-forces (always calculated even with hardware accel)
  fieldMappings.push(
    { index: -10, name: 'Lat G', enabled: true },
    { index: -11, name: 'Lon G', enabled: true },
  );
  
  const optionalFields = [
    { key: 'Satellites', index: -1 },
    { key: 'HDOP', index: -2 },
    { key: 'Altitude', index: -3 },
    { key: 'H Accuracy', index: -4 },
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
  const knownFields = new Set([
    'Lat G', 'Lon G', 'Satellites', 'HDOP', 'Altitude', 'H Accuracy',
    'RPM', 'EGT', 'Water Temp', 'Accel X', 'Accel Y', 'Accel Z',
  ]);
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
