import { ParsedData, GpsSample, FieldMapping } from '@/types/racing';
import { ensureDerivedGForcePair } from './gforceCalculation';
import {
  haversineDistance,
  parseCsvLine,
  detectDelimiter,
  validateGpsCoords,
  normalizeAccelToG,
  speedTriple,
  calculateBounds,
  KPH_TO_MPS,
  MPH_TO_MPS,
  KNOTS_TO_MPS,
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
 * Best-effort start date from the RaceStudio metadata preamble. RaceStudio
 * writes a locale-formatted `Date` row (e.g. "Sunday, December 15, 2024") and a
 * separate `Time` row ("1:34 PM"). We combine and parse leniently; if the host
 * locale isn't one the JS engine understands we return `undefined` rather than
 * an Invalid Date, so the weather lookup and session naming just fall back to
 * the first-sample time instead of breaking.
 */
function parseAimStartDate(metadataLines: string[], delimiter: string): Date | undefined {
  let dateStr = '';
  let timeStr = '';
  for (const line of metadataLines) {
    const fields = parseCsvLine(line, delimiter);
    const key = fields[0]?.toLowerCase().trim();
    if (key === 'date' && fields[1]?.trim()) dateStr = fields[1].trim();
    else if (key === 'time' && fields[1]?.trim()) timeStr = fields[1].trim();
  }
  if (!dateStr) return undefined;

  const combined = new Date(timeStr ? `${dateStr} ${timeStr}` : dateStr);
  if (!isNaN(combined.getTime())) return combined;
  const dateOnly = new Date(dateStr);
  return isNaN(dateOnly.getTime()) ? undefined : dateOnly;
}

/**
 * Map a speed-unit label to a → m/s multiplier, or null when the label names
 * no recognizable speed unit. Labels come from the units row RaceStudio writes
 * directly under the channel header (`s,km/h,#,g,...`) or from a bracketed
 * unit embedded in the header cell itself ("GPS Speed [km/h]").
 */
export function speedMultiplierFromUnitLabel(label: string | undefined): number | null {
  if (!label) return null;
  const u = label.toLowerCase();
  if (/km\/?h|kph/.test(u)) return KPH_TO_MPS;
  if (/mph/.test(u)) return MPH_TO_MPS;
  if (/m\/?s|mps/.test(u)) return 1;
  if (/\bkn?ots?\b|\bkts?\b/.test(u)) return KNOTS_TO_MPS;
  return null;
}

/** Extract a bracketed/parenthesized unit from a header cell and map it. */
function speedMultiplierFromHeaderCell(cell: string | undefined): number | null {
  if (!cell) return null;
  const match = cell.match(/[[(]([^\])]*)[\])]/);
  return match ? speedMultiplierFromUnitLabel(match[1]) : null;
}

/**
 * Infer the speed unit from the whole file's maximum speed when the export
 * carries no explicit unit label. A session whose top speed never exceeds 40
 * raw units is implausible as km/h (parking-lot pace for a logged session) but
 * typical as m/s (40 m/s = 144 km/h); anything faster is AiM's default km/h.
 * The unit must never be decided from a single sample — a car rolling out of
 * the pits at 20 km/h on the first row must not flip the whole file to m/s.
 */
export function inferSpeedMultiplierFromMax(maxSpeed: number): number {
  return maxSpeed > 0 && maxSpeed <= 40 ? 1 : KPH_TO_MPS;
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
  const normalizeHeader = (h: string) =>
    h
      .replace(/\s+/g, '_')
      .replace(/gps_latitude/i, 'gps_lat')
      .replace(/gps_longitude/i, 'gps_long');

  const colMap: Record<string, number> = {};
  headers.forEach((header, idx) => {
    colMap[normalizeHeader(header)] = idx;
    // Also register the name with a trailing bracketed unit stripped
    // ("gps speed [km/h]" → gps_speed) so unit-suffixed exports still map.
    const stripped = header.replace(/\s*[[(][^\])]*[\])]\s*$/, '').trim();
    if (stripped && stripped !== header) {
      const key = normalizeHeader(stripped);
      if (!(key in colMap)) colMap[key] = idx;
    }
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
  
  // Decide the speed unit once for the whole file: an explicit unit label
  // wins (header cell, then the units row RaceStudio writes under the
  // header); otherwise infer from the max speed across all rows.
  let speedMultiplier = KPH_TO_MPS;
  if (speedCol !== -1) {
    let explicit = speedMultiplierFromHeaderCell(headers[speedCol]);
    for (let j = headerIndex + 1; explicit === null && j <= headerIndex + 2 && j < lines.length; j++) {
      explicit = speedMultiplierFromUnitLabel(parseCsvLine(lines[j], delimiter)[speedCol]);
    }
    if (explicit !== null) {
      speedMultiplier = explicit;
    } else {
      let maxSpeed = 0;
      for (let i = headerIndex + 1; i < lines.length; i++) {
        const speedVal = parseFloat(parseCsvLine(lines[i], delimiter)[speedCol]);
        // Ignore glitch values beyond any plausible speed in any unit.
        if (!isNaN(speedVal) && speedVal <= 1000 && speedVal > maxSpeed) maxSpeed = speedVal;
      }
      speedMultiplier = inferSpeedMultiplierFromMax(maxSpeed);
    }
  }

  // Parse data rows
  const samples: GpsSample[] = [];
  let baseTime: number | null = null;
  let prevValidSample: GpsSample | null = null;

  // Detect time units from first valid data row
  let timeMultiplier = 1000; // default: seconds to ms

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
    
    // Parse speed (unit multiplier decided once for the whole file above)
    let speedMps = 0;
    if (speedCol !== -1) {
      const speedVal = parseFloat(values[speedCol]);
      if (!isNaN(speedVal)) {
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
    
    // Logger-reported g rides the native channels (channels.ts contract); the
    // primary Lat G / Lon G pair is always GPS-derived below, so the sources
    // coexist and a lone native axis can't be clobbered by the derivation.
    if (latGCol !== -1) {
      const latG = parseFloat(values[latGCol]);
      if (!isNaN(latG)) extraFields['Lat G (Native)'] = normalizeAccelToG(latG);
    }

    if (lonGCol !== -1) {
      const lonG = parseFloat(values[lonGCol]);
      if (!isNaN(lonG)) extraFields['Lon G (Native)'] = normalizeAccelToG(lonG);
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
  
  // Derive the primary GPS Lat G / Lon G pair (native channels coexist; a
  // lone primary axis from the file would be preserved as native first).
  ensureDerivedGForcePair(samples, 5);
  
  // Build field mappings from extra fields
  const fieldNames = new Set<string>();
  samples.forEach(s => Object.keys(s.extraFields).forEach(k => fieldNames.add(k)));
  
  const fieldMappings: FieldMapping[] = Array.from(fieldNames).map((name, idx) => ({
    index: idx,
    name,
    enabled: true,
  }));
  
  const duration = samples.length > 0 ? samples[samples.length - 1].t : 0;

  // Read the session date/time from the metadata rows above the channel header.
  const startDate = parseAimStartDate(lines.slice(0, headerIndex), delimiter);

  return {
    samples,
    fieldMappings,
    bounds: calculateBounds(samples),
    duration,
    startDate,
  };
}
