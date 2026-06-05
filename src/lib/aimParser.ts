import { ParsedData, GpsSample, FieldMapping } from '@/types/racing';
import { applyGForceCalculations } from './gforceCalculation';
import {
  haversineDistance,
  parseCsvLine,
  detectDelimiter,
  validateGpsCoords,
  normalizeAccelToG,
  speedTriple,
  calculateBounds,
  KPH_TO_MPS,
} from './parserUtils';

/**
 * AiM MyChron CSV Parser
 * Parses CSV exports from Race Studio 3 (RS2Analysis Style CSV)
 * Supports MyChron 5, MyChron 6, and other AiM data loggers
 */

// AiM-specific channel name patterns
const AIM_CHANNEL_PATTERNS = [
  /gps_speed/i,
  /gps_lat/i,
  /gps_long/i,
  /gps_heading/i,
  /gps_course/i,
  /acc_lat/i,
  /acc_long/i,
  /t_h2o/i,
  /t_egt/i,
  /gps_altitude/i,
  /gps_nsat/i,
];

// Headers that indicate AiM format
const AIM_HEADER_INDICATORS = [
  'gps_speed',
  'gps_lat',
  'gps_long',
  'gps_latitude',
  'gps_longitude',
  'acc_lat',
  'acc_long',
  'lateral g',
  'longitudinal g',
  't_h2o',
  't_egt',
  'gps_nsat',
];

// RaceStudio always stamps this in the first metadata cell ("Format,AiM CSV
// File"). It's an unambiguous AiM fingerprint that no other format carries — the
// router uses it (via hasAimSignature) to claim the file before the broader
// Alfano detector can.
const AIM_FILE_SIGNATURE = 'aim csv file';

/**
 * High-confidence AiM marker: the literal "AiM CSV File" stamp RaceStudio writes
 * into the metadata preamble. Used by the format router to give AiM precedence
 * over Alfano, whose loose header match (rpm/water) would otherwise claim these
 * files and then fail to parse them.
 */
export function hasAimSignature(content: string): boolean {
  return content.slice(0, 5000).toLowerCase().includes(AIM_FILE_SIGNATURE);
}

/**
 * Detect if content is AiM CSV format.
 *
 * RaceStudio exports come in two channel-naming styles — underscore
 * (`GPS_Speed`, older RS2) and space (`GPS Speed`, RS3) — and bury the channel
 * header well below the metadata preamble (~15 rows). We normalize separators so
 * both styles match the same indicators, scan deep enough to reach the header,
 * and short-circuit on the unambiguous "AiM CSV File" signature.
 */
export function isAimFormat(content: string): boolean {
  if (hasAimSignature(content)) return true;

  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return false;

  for (let i = 0; i < Math.min(20, lines.length); i++) {
    // Collapse whitespace to underscores so "GPS Speed" and "GPS_Speed" both
    // match the underscore-style indicators/patterns below.
    const line = lines[i].toLowerCase().replace(/\s+/g, '_');

    let matches = 0;
    for (const indicator of AIM_HEADER_INDICATORS) {
      if (line.includes(indicator)) {
        matches++;
      }
    }
    if (matches >= 2) {
      return true;
    }

    let patternMatches = 0;
    for (const pattern of AIM_CHANNEL_PATTERNS) {
      if (pattern.test(line)) {
        patternMatches++;
      }
    }
    if (patternMatches >= 2) {
      return true;
    }
  }

  return false;
}

/**
 * Parse AiM CSV file into ParsedData
 */
export function parseAimFile(content: string): ParsedData {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) {
    throw new Error('AiM CSV file is empty or has no data');
  }
  
  // Find header row - skip any metadata rows
  let headerIndex = -1;
  let delimiter = ',';
  
  for (let i = 0; i < Math.min(30, lines.length); i++) {
    // Normalize whitespace→underscore so space-delimited RS3 channel names
    // ("GPS Speed") match the same indicators as underscore-style RS2 exports.
    // The header sits below ~15 metadata rows, so scan deep enough to reach it.
    const line = lines[i].toLowerCase().replace(/\s+/g, '_');

    // Check if this line looks like a header with AiM channels
    let matches = 0;
    for (const indicator of AIM_HEADER_INDICATORS) {
      if (line.includes(indicator)) matches++;
    }

    if (matches >= 2 || line.includes('time') && (line.includes('gps') || line.includes('acc'))) {
      headerIndex = i;
      delimiter = detectDelimiter(lines[i]);
      break;
    }
  }
  
  if (headerIndex === -1) {
    throw new Error('Could not find AiM CSV header row');
  }
  
  const headers = parseCsvLine(lines[headerIndex], delimiter).map(h => h.toLowerCase().trim());
  
  // Map column indices
  const colMap: Record<string, number> = {};
  headers.forEach((header, idx) => {
    // Normalize common variations
    const normalized = header
      .replace(/\s+/g, '_')
      .replace(/gps_latitude/i, 'gps_lat')
      .replace(/gps_longitude/i, 'gps_long');
    colMap[normalized] = idx;
  });
  
  // Find required columns with fallbacks
  const timeCol = colMap['time'] ?? colMap['t'] ?? -1;
  const latCol = colMap['gps_lat'] ?? colMap['gps_latitude'] ?? colMap['latitude'] ?? colMap['lat'] ?? -1;
  const lonCol = colMap['gps_long'] ?? colMap['gps_longitude'] ?? colMap['longitude'] ?? colMap['lon'] ?? -1;
  const speedCol = colMap['gps_speed'] ?? colMap['speed'] ?? -1;
  const headingCol = colMap['gps_heading'] ?? colMap['gps_course'] ?? colMap['heading'] ?? colMap['course'] ?? -1;
  const altCol = colMap['gps_altitude'] ?? colMap['altitude'] ?? colMap['gps_alt'] ?? -1;
  const latGCol = colMap['acc_lat'] ?? colMap['gps_latacc'] ?? colMap['lateral_g'] ?? colMap['lat_g'] ?? colMap['gy'] ?? -1;
  const lonGCol = colMap['acc_long'] ?? colMap['gps_lonacc'] ?? colMap['longitudinal_g'] ?? colMap['lon_g'] ?? colMap['long_g'] ?? colMap['gx'] ?? -1;
  const rpmCol = colMap['rpm'] ?? colMap['engine_rpm'] ?? -1;
  const waterTempCol = colMap['t_h2o'] ?? colMap['water_temp'] ?? colMap['coolant'] ?? -1;
  const egtCol = colMap['t_egt'] ?? colMap['egt'] ?? colMap['exhaust_temp'] ?? -1;
  const throttleCol = colMap['throttle'] ?? colMap['tps'] ?? colMap['throttle_pos'] ?? -1;
  const satsCol = colMap['gps_nsat'] ?? colMap['satellites'] ?? colMap['nsat'] ?? -1;
  
  if (latCol === -1 || lonCol === -1) {
    throw new Error('AiM CSV missing required GPS coordinates (GPS_Lat, GPS_Long)');
  }
  
  // Parse data rows
  const samples: GpsSample[] = [];
  let baseTime: number | null = null;
  let prevValidSample: GpsSample | null = null;
  
  // Detect time and speed units from first valid data row
  let timeMultiplier = 1000; // default: seconds to ms
  let speedMultiplier = KPH_TO_MPS; // default: km/h to m/s
  
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i], delimiter);
    if (values.length < Math.max(latCol, lonCol) + 1) continue;
    
    const lat = parseFloat(values[latCol]);
    const lon = parseFloat(values[lonCol]);

    if (validateGpsCoords(lat, lon) !== null) continue;
    
    // Parse time
    let timeMs = 0;
    if (timeCol !== -1) {
      const timeVal = parseFloat(values[timeCol]);
      if (!isNaN(timeVal)) {
        // Detect if time is in seconds (small values) or ms (large values)
        if (baseTime === null && timeVal < 10000) {
          timeMultiplier = 1000; // seconds
        } else if (baseTime === null && timeVal >= 10000) {
          timeMultiplier = 1; // already ms
        }
        
        if (baseTime === null) baseTime = timeVal;
        timeMs = (timeVal - baseTime) * timeMultiplier;
      }
    }
    
    // Parse speed
    let speedMps = 0;
    if (speedCol !== -1) {
      const speedVal = parseFloat(values[speedCol]);
      if (!isNaN(speedVal)) {
        // AiM typically exports in km/h, but detect if already m/s
        // Values over 100 are likely km/h, under 50 might be m/s
        if (samples.length === 0 && speedVal > 50) {
          speedMultiplier = KPH_TO_MPS; // km/h to m/s
        } else if (samples.length === 0 && speedVal > 0 && speedVal < 30) {
          speedMultiplier = 1; // already m/s
        }
        speedMps = speedVal * speedMultiplier;
      }
    }
    
    // Teleportation filter
    if (prevValidSample) {
      const dt = (timeMs - prevValidSample.t) / 1000;
      if (dt > 0) {
        const dist = haversineDistance(prevValidSample.lat, prevValidSample.lon, lat, lon);
        const impliedSpeed = dist / dt;
        // Max 100 m/s (360 km/h) - reasonable for karts
        if (impliedSpeed > 100) continue;
      }
    }
    
    // Build extra fields
    const extraFields: Record<string, number> = {};
    
    if (altCol !== -1) {
      const alt = parseFloat(values[altCol]);
      if (!isNaN(alt)) extraFields['Altitude'] = alt;
    }
    
    if (latGCol !== -1) {
      const latG = parseFloat(values[latGCol]);
      if (!isNaN(latG)) extraFields['Lat G'] = normalizeAccelToG(latG);
    }

    if (lonGCol !== -1) {
      const lonG = parseFloat(values[lonGCol]);
      if (!isNaN(lonG)) extraFields['Lon G'] = normalizeAccelToG(lonG);
    }
    
    if (rpmCol !== -1) {
      const rpm = parseFloat(values[rpmCol]);
      if (!isNaN(rpm)) extraFields['RPM'] = rpm;
    }
    
    if (waterTempCol !== -1) {
      const temp = parseFloat(values[waterTempCol]);
      if (!isNaN(temp)) extraFields['Water Temp'] = temp;
    }
    
    if (egtCol !== -1) {
      const temp = parseFloat(values[egtCol]);
      if (!isNaN(temp)) extraFields['EGT'] = temp;
    }
    
    if (throttleCol !== -1) {
      const thr = parseFloat(values[throttleCol]);
      if (!isNaN(thr)) extraFields['Throttle'] = thr;
    }
    
    if (satsCol !== -1) {
      const sats = parseFloat(values[satsCol]);
      if (!isNaN(sats)) extraFields['Satellites'] = sats;
    }
    
    // Parse heading
    let heading: number | undefined;
    if (headingCol !== -1) {
      const h = parseFloat(values[headingCol]);
      if (!isNaN(h)) heading = h;
    }
    
    const sample: GpsSample = {
      t: timeMs,
      lat,
      lon,
      ...speedTriple(speedMps),
      heading,
      extraFields,
    };

    samples.push(sample);
    prevValidSample = sample;
  }
  
  if (samples.length === 0) {
    throw new Error('No valid GPS samples found in AiM file');
  }
  
  // Calculate G-forces from GPS if not natively available
  const hasNativeLatG = samples.some(s => 'Lat G' in s.extraFields);
  const hasNativeLonG = samples.some(s => 'Lon G' in s.extraFields);
  
  if (!hasNativeLatG || !hasNativeLonG) {
    // Use the improved shared G-force calculation
    applyGForceCalculations(samples, 5);
  }
  
  // Build field mappings from extra fields
  const fieldNames = new Set<string>();
  samples.forEach(s => Object.keys(s.extraFields).forEach(k => fieldNames.add(k)));
  
  const fieldMappings: FieldMapping[] = Array.from(fieldNames).map((name, idx) => ({
    index: idx,
    name,
    enabled: true,
  }));
  
  const duration = samples.length > 0 ? samples[samples.length - 1].t : 0;
  
  return {
    samples,
    fieldMappings,
    bounds: calculateBounds(samples),
    duration,
  };
}
