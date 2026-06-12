import { GpsSample, FieldMapping, ParsedData } from '@/types/racing';
import { applyGForceCalculations } from './gforceCalculation';
import {
  isTeleportation,
  MAX_SPEED_MPS,
  KPH_TO_MPS,
  parseCsvLine,
  validateGpsCoords,
  normalizeAccelToG,
  normalizeHeading,
  speedTriple,
  calculateBounds,
} from './parserUtils';

/**
 * Alfano CSV Parser
 * 
 * Alfano data loggers export CSV files with metadata preamble followed by data.
 * Common exports from Alfano ADA app or Off Camber Data.
 * 
 * Typical structure:
 * - Metadata rows (Driver:, Track:, Date:, etc.)
 * - Header row with column names
 * - Data rows
 */

// Alfano-specific column header patterns (case-insensitive)
const ALFANO_HEADERS = [
  'gps_latitude', 'gps_longitude', 'gps_speed', 'gps_heading', 'gps_altitude',
  'latacc', 'lonacc', 'lat acc', 'lon acc', 'lateral acc', 'longitudinal acc',
  'rpm', 't1', 't2', 'egt', 'water', 'oil', 'throttle', 'lap', 'laptime'
];

// Metadata patterns that indicate Alfano format
const ALFANO_METADATA_PATTERNS = [
  /^driver\s*:/i,
  /^track\s*:/i,
  /^championship\s*:/i,
  /^session\s*:/i,
  /^date\s*:/i,
  /^kart\s*:/i,
  /^engine\s*:/i,
];

// Check if content is Alfano CSV format
export function isAlfanoFormat(content: string): boolean {
  const firstLines = content.substring(0, 3000).toLowerCase();
  
  // Check for Alfano-specific column headers
  const hasAlfanoHeaders = ALFANO_HEADERS.some(h => firstLines.includes(h));
  
  // Check for metadata preamble
  const lines = content.split(/\r?\n/).slice(0, 20);
  const hasMetadata = lines.some(line => 
    ALFANO_METADATA_PATTERNS.some(pattern => pattern.test(line))
  );
  
  // Need either specific Alfano headers or metadata patterns
  // But not VBO format markers
  if (firstLines.includes('[header]') || firstLines.includes('[data]')) {
    return false; // This is VBO format
  }
  
  return hasAlfanoHeaders || hasMetadata;
}

// Column name mappings (Alfano header → internal name)
const COLUMN_MAPPINGS: Record<string, string> = {
  // Time
  'time': 'time',
  'timestamp': 'time',
  'elapsed': 'time',
  'elapsed time': 'time',
  'time (s)': 'time',
  'time (ms)': 'time_ms',
  
  // GPS
  'gps_latitude': 'lat',
  'gps_longitude': 'lon',
  'latitude': 'lat',
  'longitude': 'lon',
  'lat': 'lat',
  'lon': 'lon',
  'long': 'lon',
  'gps_speed': 'speed',
  'speed': 'speed',
  'speed (km/h)': 'speed',
  'speed (kph)': 'speed',
  'velocity': 'speed',
  'gps_heading': 'heading',
  'heading': 'heading',
  'course': 'heading',
  'gps_altitude': 'altitude',
  'altitude': 'altitude',
  'height': 'altitude',
  'alt': 'altitude',
  
  // Accelerometers
  'latacc': 'latG',
  'lat acc': 'latG',
  'lateral acc': 'latG',
  'lateral acceleration': 'latG',
  'lat g': 'latG',
  'lateral g': 'latG',
  'lonacc': 'lonG',
  'lon acc': 'lonG',
  'longitudinal acc': 'lonG',
  'longitudinal acceleration': 'lonG',
  'lon g': 'lonG',
  'longitudinal g': 'lonG',
  
  // Engine
  'rpm': 'rpm',
  'engine rpm': 'rpm',
  
  // Temperatures
  't1': 'temp1',
  't2': 'temp2',
  'temp1': 'temp1',
  'temp2': 'temp2',
  'egt': 'egt',
  'exhaust': 'egt',
  'water': 'water_temp',
  'water temp': 'water_temp',
  'oil': 'oil_temp',
  'oil temp': 'oil_temp',
  
  // Other
  'throttle': 'throttle',
  'tps': 'throttle',
  'lap': 'lap',
  'laptime': 'laptime',
  'lap time': 'laptime',
  'distance': 'distance',
  'satellites': 'satellites',
  'sats': 'satellites',
};

/**
 * Detect Alfano CSV delimiter (typically comma, sometimes semicolon).
 * Scans the first 20 lines for whichever delimiter wins by count.
 */
function detectAlfanoDelimiter(lines: string[]): string {
  for (const line of lines.slice(0, 20)) {
    const commas = (line.match(/,/g) || []).length;
    const semis = (line.match(/;/g) || []).length;
    if (commas > 0 || semis > 0) return semis > commas ? ';' : ',';
  }
  return ',';
}

/**
 * Decide the generic `time` column's unit for the whole file, returning the
 * multiplier to milliseconds (1 = already ms, 1000 = seconds).
 *
 * - Any value above 100,000 can only be ms (≈27.8 h is impossible as seconds
 *   since start/midnight).
 * - Otherwise the median step between consecutive rows decides: at any
 *   plausible log rate (1–50 Hz) a seconds column advances by ≤ 1 per row,
 *   while a ms column advances by tens to hundreds.
 * - An empty/constant column falls back to seconds (the historical default).
 */
export function detectAlfanoTimeMultiplier(timeValues: number[]): number {
  if (timeValues.length === 0) return 1000;

  let max = -Infinity;
  for (const v of timeValues) if (v > max) max = v;
  if (max > 100000) return 1;

  const deltas: number[] = [];
  for (let i = 1; i < timeValues.length; i++) {
    const d = timeValues[i] - timeValues[i - 1];
    if (d > 0) deltas.push(d);
  }
  if (deltas.length === 0) return 1000;
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  return median >= 5 ? 1 : 1000;
}

export function parseAlfanoFile(content: string): ParsedData {
  const lines = content.split(/\r?\n/);
  const delimiter = detectAlfanoDelimiter(lines);

  // Find the header row (first row with recognizable column names)
  let headerIndex = -1;
  let columnMap: Record<string, number> = {};

  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCsvLine(line, delimiter);
    
    // Check if this looks like a header row
    let matchCount = 0;
    const tempMap: Record<string, number> = {};
    
    for (let j = 0; j < fields.length; j++) {
      const normalized = fields[j].toLowerCase().trim();
      const mapped = COLUMN_MAPPINGS[normalized];
      if (mapped) {
        tempMap[mapped] = j;
        matchCount++;
      }
    }
    
    // Need at least lat/lon or speed to be a valid header
    if (matchCount >= 2 && (tempMap['lat'] !== undefined || tempMap['speed'] !== undefined)) {
      headerIndex = i;
      columnMap = tempMap;
      break;
    }
  }
  
  if (headerIndex === -1) {
    throw new Error('Could not find valid header row in Alfano CSV');
  }
  
  // Decide the generic time column's unit ONCE for the whole file. The old
  // per-row heuristic (`> 100000 ? ms : ×1000`) flipped units mid-file: a
  // ms-based column had its first 100 seconds multiplied by 1000, then
  // collapsed — time ran backwards and the midnight patch added a fake day.
  let timeMultiplier = 1000; // seconds → ms (the historical default)
  if (columnMap['time'] !== undefined && columnMap['time_ms'] === undefined) {
    const timeValues: number[] = [];
    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || ALFANO_METADATA_PATTERNS.some(p => p.test(line))) continue;
      const v = parseFloat(parseCsvLine(line, delimiter)[columnMap['time']]);
      if (!isNaN(v)) timeValues.push(v);
    }
    timeMultiplier = detectAlfanoTimeMultiplier(timeValues);
  }

  // Parse data rows
  const samples: GpsSample[] = [];
  let baseTimeMs: number | null = null;
  let startDate: Date | undefined;
  let hasNativeG = false;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Skip metadata rows that might appear after header
    if (ALFANO_METADATA_PATTERNS.some(p => p.test(line))) continue;

    const fields = parseCsvLine(line, delimiter);
    if (fields.length < 3) continue;

    // Parse coordinates
    const lat = columnMap['lat'] !== undefined ? parseFloat(fields[columnMap['lat']]) : NaN;
    const lon = columnMap['lon'] !== undefined ? parseFloat(fields[columnMap['lon']]) : NaN;

    if (validateGpsCoords(lat, lon) !== null) continue;
    
    // Parse time
    let timeMs = 0;
    if (columnMap['time_ms'] !== undefined) {
      timeMs = parseFloat(fields[columnMap['time_ms']]) || 0;
    } else if (columnMap['time'] !== undefined) {
      const timeVal = parseFloat(fields[columnMap['time']]);
      if (!isNaN(timeVal)) {
        timeMs = timeVal * timeMultiplier;
      }
    }
    
    if (baseTimeMs === null) {
      baseTimeMs = timeMs;
    }
    
    let t = timeMs - baseTimeMs;
    if (t < 0) t += 86400000; // Handle midnight wrap
    
    // Parse speed (assume km/h)
    let speedKph = 0;
    if (columnMap['speed'] !== undefined) {
      speedKph = parseFloat(fields[columnMap['speed']]) || 0;
    }
    const speedMps = speedKph * KPH_TO_MPS;

    // Sanity check on speed
    if (speedMps > MAX_SPEED_MPS) continue;

    // Parse heading
    let heading: number | undefined;
    if (columnMap['heading'] !== undefined) {
      const h = parseFloat(fields[columnMap['heading']]);
      if (!isNaN(h)) heading = normalizeHeading(h);
    }
    
    // Teleportation filter
    if (samples.length > 0) {
      const prev = samples[samples.length - 1];
      if (isTeleportation(prev.lat, prev.lon, prev.t, lat, lon, t, 'Alfano')) continue;
    }
    
    // Build extra fields
    const extraFields: Record<string, number> = {};
    
    // Native G-forces (may be in m/s² or G — Alfano uses a higher threshold than other formats)
    if (columnMap['latG'] !== undefined) {
      const latG = parseFloat(fields[columnMap['latG']]);
      if (!isNaN(latG)) {
        extraFields['Lat G (Native)'] = normalizeAccelToG(latG, 10);
        hasNativeG = true;
      }
    }

    if (columnMap['lonG'] !== undefined) {
      const lonG = parseFloat(fields[columnMap['lonG']]);
      if (!isNaN(lonG)) {
        extraFields['Lon G (Native)'] = normalizeAccelToG(lonG, 10);
        hasNativeG = true;
      }
    }
    
    // Altitude
    if (columnMap['altitude'] !== undefined) {
      const alt = parseFloat(fields[columnMap['altitude']]);
      if (!isNaN(alt)) extraFields['Altitude (m)'] = alt;
    }
    
    // RPM
    if (columnMap['rpm'] !== undefined) {
      const rpm = parseFloat(fields[columnMap['rpm']]);
      if (!isNaN(rpm) && rpm >= 0) extraFields['RPM'] = rpm;
    }
    
    // Temperatures
    if (columnMap['temp1'] !== undefined) {
      const temp = parseFloat(fields[columnMap['temp1']]);
      if (!isNaN(temp)) extraFields['Temp 1'] = temp;
    }
    if (columnMap['temp2'] !== undefined) {
      const temp = parseFloat(fields[columnMap['temp2']]);
      if (!isNaN(temp)) extraFields['Temp 2'] = temp;
    }
    if (columnMap['egt'] !== undefined) {
      const temp = parseFloat(fields[columnMap['egt']]);
      if (!isNaN(temp)) extraFields['EGT'] = temp;
    }
    if (columnMap['water_temp'] !== undefined) {
      const temp = parseFloat(fields[columnMap['water_temp']]);
      if (!isNaN(temp)) extraFields['Water Temp'] = temp;
    }
    if (columnMap['oil_temp'] !== undefined) {
      const temp = parseFloat(fields[columnMap['oil_temp']]);
      if (!isNaN(temp)) extraFields['Oil Temp'] = temp;
    }
    
    // Throttle
    if (columnMap['throttle'] !== undefined) {
      const throttle = parseFloat(fields[columnMap['throttle']]);
      if (!isNaN(throttle)) extraFields['Throttle'] = throttle;
    }
    
    // Distance
    if (columnMap['distance'] !== undefined) {
      const dist = parseFloat(fields[columnMap['distance']]);
      if (!isNaN(dist)) extraFields['Distance'] = dist;
    }
    
    // Satellites
    if (columnMap['satellites'] !== undefined) {
      const sats = parseInt(fields[columnMap['satellites']], 10);
      if (!isNaN(sats)) extraFields['Satellites'] = sats;
    }
    
    samples.push({
      t,
      lat,
      lon,
      ...speedTriple(speedMps),
      heading,
      extraFields
    });
  }
  
  if (samples.length === 0) {
    throw new Error('No valid GPS data found in Alfano file');
  }
  
  // Calculate GPS-derived G-forces
  applyGForceCalculations(samples, 5);
  
  // Build field mappings
  const fieldMappings: FieldMapping[] = [
    { index: -10, name: 'Lat G', enabled: true },
    { index: -11, name: 'Lon G', enabled: true },
  ];
  
  // Add native G fields if they exist
  if (hasNativeG) {
    if (samples.some(s => s.extraFields['Lat G (Native)'] !== undefined)) {
      fieldMappings.push({ index: -12, name: 'Lat G (Native)', enabled: true });
    }
    if (samples.some(s => s.extraFields['Lon G (Native)'] !== undefined)) {
      fieldMappings.push({ index: -13, name: 'Lon G (Native)', enabled: true });
    }
  }
  
  // Add other fields if present
  const optionalFields = [
    { key: 'Altitude (m)', index: -3 },
    { key: 'Satellites', index: -1 },
    { key: 'RPM', index: -20 },
    { key: 'Temp 1', index: -21 },
    { key: 'Temp 2', index: -22 },
    { key: 'EGT', index: -23 },
    { key: 'Water Temp', index: -24 },
    { key: 'Oil Temp', index: -25 },
    { key: 'Throttle', index: -26 },
    { key: 'Distance', index: -15 },
  ];
  
  for (const field of optionalFields) {
    if (samples.some(s => s.extraFields[field.key] !== undefined)) {
      fieldMappings.push({ index: field.index, name: field.key, enabled: true });
    }
  }
  
  return {
    samples,
    fieldMappings,
    bounds: calculateBounds(samples),
    duration: samples[samples.length - 1].t,
    startDate
  };
}
