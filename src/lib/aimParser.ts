import { ParsedData, GpsSample, FieldMapping } from '@/types/racing';
import { applyGForceCalculations } from './gforceCalculation';
import { clamp, haversineDistance } from './parserUtils';

/**
 * AiM MyChron CSV Parser
 * Parses CSV exports from Race Studio 3 (RS2Analysis Style CSV)
 * Supports MyChron 5, MyChron 6, and other AiM data loggers
 */

// Parse a CSV line handling quoted fields
function parseCSVLine(line: string, delimiter: string = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Detect CSV delimiter
function detectDelimiter(line: string): string {
  const commaCount = (line.match(/,/g) || []).length;
  const semicolonCount = (line.match(/;/g) || []).length;
  const tabCount = (line.match(/\t/g) || []).length;
  
  if (tabCount > commaCount && tabCount > semicolonCount) return '\t';
  if (semicolonCount > commaCount) return ';';
  return ',';
}

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

/**
 * Detect if content is AiM CSV format
 */
export function isAimFormat(content: string): boolean {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return false;
  
  // Look for AiM-specific channel names in the first few lines
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i].toLowerCase();
    
    // Count how many AiM-specific indicators we find
    let matches = 0;
    for (const indicator of AIM_HEADER_INDICATORS) {
      if (line.includes(indicator)) {
        matches++;
      }
    }
    
    // If we find 2+ AiM-specific headers, it's likely AiM format
    if (matches >= 2) {
      return true;
    }
    
    // Also check for regex patterns
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
  
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i].toLowerCase();
    
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
  
  const headers = parseCSVLine(lines[headerIndex], delimiter).map(h => h.toLowerCase().trim());
  
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
  const latGCol = colMap['acc_lat'] ?? colMap['lateral_g'] ?? colMap['lat_g'] ?? colMap['gy'] ?? -1;
  const lonGCol = colMap['acc_long'] ?? colMap['longitudinal_g'] ?? colMap['lon_g'] ?? colMap['long_g'] ?? colMap['gx'] ?? -1;
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
  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;
  let baseTime: number | null = null;
  let prevValidSample: GpsSample | null = null;
  
  // Detect time and speed units from first valid data row
  let timeMultiplier = 1000; // default: seconds to ms
  let speedMultiplier = 1 / 3.6; // default: km/h to m/s
  
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delimiter);
    if (values.length < Math.max(latCol, lonCol) + 1) continue;
    
    const lat = parseFloat(values[latCol]);
    const lon = parseFloat(values[lonCol]);
    
    // Skip invalid coordinates
    if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    
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
          speedMultiplier = 1 / 3.6; // km/h to m/s
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
      let latG = parseFloat(values[latGCol]);
      if (!isNaN(latG)) {
        // If value seems to be in m/s², convert to G
        if (Math.abs(latG) > 5) latG = latG / 9.81;
        extraFields['Lat G'] = clamp(latG, -5, 5);
      }
    }
    
    if (lonGCol !== -1) {
      let lonG = parseFloat(values[lonGCol]);
      if (!isNaN(lonG)) {
        if (Math.abs(lonG) > 5) lonG = lonG / 9.81;
        extraFields['Lon G'] = clamp(lonG, -5, 5);
      }
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
      speedMps,
      speedMph: speedMps * 2.23694,
      speedKph: speedMps * 3.6,
      heading,
      extraFields,
    };
    
    samples.push(sample);
    prevValidSample = sample;
    
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
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
    bounds: { minLat, maxLat, minLon, maxLon },
    duration,
  };
}
