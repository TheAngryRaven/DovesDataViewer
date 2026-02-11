import { GpsSample, FieldMapping, ParsedData } from '@/types/racing';
import { applyGForceCalculations } from './gforceCalculation';
import { haversineDistance, calculateBearing, isTeleportation, MAX_SPEED_MPS } from './parserUtils';

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
    
    // Speed sanity check
    if (speedMps > MAX_SPEED_MPS) continue;

    // Teleportation filter
    if (samples.length > 0) {
      const prev = samples[samples.length - 1];
      if (isTeleportation(prev.lat, prev.lon, prev.t, lat, lng, t, 'Dove')) continue;
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
  applyGForceCalculations(samples, 5);
  
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
