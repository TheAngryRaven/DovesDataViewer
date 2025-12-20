import { GpsSample, FieldMapping, ParsedData } from '@/types/racing';

// Parse NMEA latitude (ddmm.mmmm format)
function parseNmeaLat(value: string, dir: string): number {
  if (!value || value.length < 4) return 0;
  const deg = parseInt(value.substring(0, 2), 10);
  const min = parseFloat(value.substring(2));
  let lat = deg + min / 60;
  if (dir === 'S') lat = -lat;
  return lat;
}

// Parse NMEA longitude (dddmm.mmmm format)
function parseNmeaLon(value: string, dir: string): number {
  if (!value || value.length < 5) return 0;
  const deg = parseInt(value.substring(0, 3), 10);
  const min = parseFloat(value.substring(3));
  let lon = deg + min / 60;
  if (dir === 'W') lon = -lon;
  return lon;
}

// Parse NMEA time (hhmmss.sss format)
function parseNmeaTime(value: string): { hours: number; minutes: number; seconds: number; ms: number } {
  if (!value || value.length < 6) return { hours: 0, minutes: 0, seconds: 0, ms: 0 };
  const hours = parseInt(value.substring(0, 2), 10);
  const minutes = parseInt(value.substring(2, 4), 10);
  const secondsStr = value.substring(4);
  const seconds = Math.floor(parseFloat(secondsStr));
  const ms = Math.round((parseFloat(secondsStr) - seconds) * 1000);
  return { hours, minutes, seconds, ms };
}

// Parse NMEA date (ddmmyy format)
function parseNmeaDate(value: string): { day: number; month: number; year: number } | null {
  if (!value || value.length < 6) return null;
  const day = parseInt(value.substring(0, 2), 10);
  const month = parseInt(value.substring(2, 4), 10);
  const year = 2000 + parseInt(value.substring(4, 6), 10);
  return { day, month, year };
}

// Convert knots to m/s
function knotsToMps(knots: number): number {
  return knots * 0.514444;
}

interface ParsedRmc {
  lat: number;
  lon: number;
  timeMs: number; // ms since midnight
  speedMps: number | null;
  heading: number | null; // Course over ground in degrees
  date: { day: number; month: number; year: number } | null;
  valid: boolean;
}

interface ParsedGga {
  timeMs: number;
  satellites: number;
  hdop: number;
  altitude: number;
}

function parseRmcSentence(sentence: string): ParsedRmc | null {
  // Remove quotes if wrapped
  sentence = sentence.replace(/^"|"$/g, '').trim();
  
  const parts = sentence.split(',');
  if (parts.length < 10) return null;

  const type = parts[0];
  
  // Only parse RMC sentences - they have position AND speed
  if (type !== '$GPRMC' && type !== '$GNRMC') {
    return null;
  }
  
  // RMC sentence: $GPRMC,hhmmss.ss,A,llll.ll,a,yyyyy.yy,a,x.x,x.x,ddmmyy,...
  const status = parts[2];
  if (status !== 'A') return null; // Not valid fix
  
  const time = parseNmeaTime(parts[1]);
  const lat = parseNmeaLat(parts[3], parts[4]);
  const lon = parseNmeaLon(parts[5], parts[6]);
  
  // Skip samples with invalid coordinates (0,0 is a common GPS error/default)
  if (lat === 0 || lon === 0) return null;
  
  const speedKnots = parseFloat(parts[7]) || 0;
  // parts[8] is course over ground (heading) in degrees
  const heading = parts[8] ? parseFloat(parts[8]) : null;
  const date = parseNmeaDate(parts[9]);
  
  const timeMs = (time.hours * 3600 + time.minutes * 60 + time.seconds) * 1000 + time.ms;
  
  return {
    lat,
    lon,
    timeMs,
    speedMps: knotsToMps(speedKnots),
    heading: heading !== null && !isNaN(heading) ? heading : null,
    date,
    valid: true
  };
}

function parseGgaSentence(sentence: string): ParsedGga | null {
  // Remove quotes if wrapped
  sentence = sentence.replace(/^"|"$/g, '').trim();
  
  const parts = sentence.split(',');
  if (parts.length < 10) return null;

  const type = parts[0];
  
  // Parse GGA sentences: $GPGGA or $GNGGA
  if (type !== '$GPGGA' && type !== '$GNGGA') {
    return null;
  }
  
  // GGA: $GPGGA,hhmmss.ss,llll.ll,a,yyyyy.yy,a,q,nn,x.x,x.x,M,...
  // Field 1: time, 7: satellites, 8: HDOP, 9: altitude, 10: altitude units
  
  const fixQuality = parseInt(parts[6], 10);
  if (fixQuality === 0) return null; // No fix
  
  const time = parseNmeaTime(parts[1]);
  const satellites = parseInt(parts[7], 10) || 0;
  const hdop = parseFloat(parts[8]) || 0;
  const altitude = parseFloat(parts[9]) || 0;
  
  const timeMs = (time.hours * 3600 + time.minutes * 60 + time.seconds) * 1000 + time.ms;
  
  return {
    timeMs,
    satellites,
    hdop,
    altitude
  };
}

// Haversine distance in meters
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculate speed from two GPS points with sanity checks
function calculateSpeed(lat1: number, lon1: number, t1: number, lat2: number, lon2: number, t2: number): number | null {
  const timeDiff = (t2 - t1) / 1000; // seconds
  
  // Need at least 50ms time difference to calculate speed reliably
  if (timeDiff < 0.05) return null;
  
  const distance = haversineDistance(lat1, lon1, lat2, lon2);
  const speedMps = distance / timeDiff;
  
  // Sanity check: max reasonable speed is ~150 m/s (~335 mph) for race cars
  // Anything above this is likely GPS glitch
  if (speedMps > 150) return null;
  
  return speedMps;
}

// Normalize heading delta to handle wrap-around (e.g., 359° → 1° = +2° not -358°)
function normalizeHeadingDelta(h2: number | undefined, h1: number | undefined): number {
  if (h2 === undefined || h1 === undefined) return 0;
  let delta = h2 - h1;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

// Clamp value to range
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Calculate lateral and longitudinal G-forces from GPS data
// Lateral G: centripetal acceleration = v * (dHeading/dt)
// Longitudinal G: rate of change of speed = dv/dt
function calculateAccelerations(samples: GpsSample[]): void {
  const GRAVITY = 9.80665; // m/s²
  const MAX_G = 3.0; // reasonable max for karts
  const MIN_DT = 0.05; // minimum time delta in seconds
  
  for (let i = 0; i < samples.length; i++) {
    // Use central difference for smoother derivatives
    const prevIdx = Math.max(0, i - 1);
    const nextIdx = Math.min(samples.length - 1, i + 1);
    
    const prev = samples[prevIdx];
    const curr = samples[i];
    const next = samples[nextIdx];
    
    const dt = (next.t - prev.t) / 1000; // seconds
    
    if (dt < MIN_DT) {
      // Not enough time delta, set to 0
      curr.extraFields['Lat G'] = 0;
      curr.extraFields['Lon G'] = 0;
      continue;
    }
    
    // Longitudinal G: rate of change of speed
    const dv = next.speedMps - prev.speedMps;
    const lonG = (dv / dt) / GRAVITY;
    
    // Lateral G: v * (dHeading/dt)
    // Handle heading wrap-around (359° → 1° = +2° not -358°)
    const dHeading = normalizeHeadingDelta(next.heading, prev.heading);
    const yawRate = (dHeading * Math.PI / 180) / dt; // rad/s
    const latG = (curr.speedMps * yawRate) / GRAVITY;
    
    // Clamp to reasonable values
    curr.extraFields['Lat G'] = clamp(latG, -MAX_G, MAX_G);
    curr.extraFields['Lon G'] = clamp(lonG, -MAX_G, MAX_G);
  }
}

// Apply simple moving average smoothing to a field
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

export function parseDatalog(content: string): ParsedData {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) {
    throw new Error('Empty file');
  }

  // Check if first line is a header
  const firstLine = lines[0];
  const hasHeader = !firstLine.startsWith('$') && !firstLine.startsWith('"$');
  
  let headerFields: string[] = [];
  let dataStartIndex = 0;

  if (hasHeader) {
    // Parse header - split by comma but respect quotes
    headerFields = parseCSVLine(firstLine);
    dataStartIndex = 1;
  }

  // First pass: collect all GGA data indexed by timeMs
  const ggaData = new Map<number, ParsedGga>();
  let hasGgaData = false;
  
  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const fields = parseCSVLine(line);
    if (fields.length === 0) continue;
    
    const nmeaSentence = fields[0];
    const gga = parseGgaSentence(nmeaSentence);
    if (gga) {
      ggaData.set(gga.timeMs, gga);
      hasGgaData = true;
    }
  }

  const samples: GpsSample[] = [];
  const fieldMappings: FieldMapping[] = [];
  let fieldMappingsCreated = false;
  
  let baseTimeMs = 0;
  let lastTimeMs = 0;
  let dayOffset = 0;
  let ggaDayOffset = 0;
  let lastGgaTimeMs = 0;

  // Helper to find closest GGA data within tolerance
  const findGgaData = (timeMs: number): ParsedGga | null => {
    // Handle midnight wrap for GGA lookup
    let lookupTime = timeMs % 86400000; // Time of day
    
    // Direct match
    if (ggaData.has(lookupTime)) {
      return ggaData.get(lookupTime)!;
    }
    
    // Search within 500ms tolerance
    for (let offset = 1; offset <= 500; offset++) {
      if (ggaData.has(lookupTime + offset)) return ggaData.get(lookupTime + offset)!;
      if (ggaData.has(lookupTime - offset)) return ggaData.get(lookupTime - offset)!;
    }
    
    return null;
  };

  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    if (fields.length === 0) continue;

    // First field should be NMEA sentence
    const nmeaSentence = fields[0];
    const parsed = parseRmcSentence(nmeaSentence);
    
    if (!parsed || !parsed.valid) continue;
    
    // Handle time wrapping (midnight)
    let currentTimeMs = parsed.timeMs + dayOffset;
    if (lastTimeMs > 0 && currentTimeMs < lastTimeMs - 43200000) { // 12 hours back = probably midnight wrap
      dayOffset += 86400000; // Add 24 hours
      currentTimeMs = parsed.timeMs + dayOffset;
    }
    lastTimeMs = currentTimeMs;

    // Set base time from first valid sample
    if (samples.length === 0) {
      baseTimeMs = currentTimeMs;
    }

    const t = currentTimeMs - baseTimeMs;

    // Parse extra fields from CSV columns
    const extraFields: Record<string, number> = {};
    
    if (!fieldMappingsCreated && fields.length > 1) {
      for (let j = 1; j < fields.length; j++) {
        const name = hasHeader && headerFields[j] ? headerFields[j] : `Field ${j}`;
        const value = parseFloat(fields[j]);
        if (!isNaN(value)) {
          fieldMappings.push({
            index: j,
            name: name,
            enabled: true
          });
        }
      }
      fieldMappingsCreated = true;
    }

    for (const mapping of fieldMappings) {
      if (fields[mapping.index]) {
        const value = parseFloat(fields[mapping.index]);
        if (!isNaN(value)) {
          extraFields[mapping.name] = value;
        }
      }
    }
    
    // Look up GGA data for this timestamp
    const gga = findGgaData(parsed.timeMs);
    if (gga) {
      extraFields['Satellites'] = gga.satellites;
      extraFields['HDOP'] = gga.hdop;
      extraFields['Altitude (m)'] = gga.altitude;
    }

    // Get speed from NMEA or calculate it
    let speedMps = parsed.speedMps;
    
    // If no speed from NMEA, try to calculate from position
    if (speedMps === null && samples.length > 0) {
      const prev = samples[samples.length - 1];
      speedMps = calculateSpeed(prev.lat, prev.lon, prev.t, parsed.lat, parsed.lon, t);
    }
    
    // Skip samples with no valid speed
    if (speedMps === null) {
      speedMps = 0;
    }
    
    // Additional sanity check on speed from NMEA data
    // Max reasonable speed: 150 m/s (~335 mph)
    if (speedMps > 150) {
      // GPS glitch - use previous sample's speed or 0
      speedMps = samples.length > 0 ? samples[samples.length - 1].speedMps : 0;
    }

    // Teleportation filter: if this sample is too far from the previous one, skip it
    // Max reasonable distance is ~50 meters per 40ms sample (which is ~450 km/h / 280 mph)
    if (samples.length > 0) {
      const prev = samples[samples.length - 1];
      const timeDiff = (t - prev.t) / 1000; // seconds
      if (timeDiff > 0 && timeDiff < 10) { // Only check for samples within 10 seconds
        const distance = haversineDistance(prev.lat, prev.lon, parsed.lat, parsed.lon);
        const maxDistance = 50 * (timeDiff / 0.04); // 50m per 40ms, scaled by actual time diff
        if (distance > maxDistance && distance > 100) { // Allow some slack, but flag big jumps
          console.warn(`GPS teleportation detected: ${distance.toFixed(0)}m in ${timeDiff.toFixed(3)}s at sample ${samples.length}`);
          continue; // Skip this sample
        }
      }
    }

    samples.push({
      t,
      lat: parsed.lat,
      lon: parsed.lon,
      speedMps,
      speedMph: speedMps * 2.23694,
      speedKph: speedMps * 3.6,
      heading: parsed.heading ?? undefined,
      rawNmea: nmeaSentence,
      extraFields
    });
  }

  if (samples.length === 0) {
    throw new Error('No valid GPS data found in file');
  }

  // Calculate lateral and longitudinal G-forces from GPS heading and speed
  calculateAccelerations(samples);
  
  // Apply smoothing to G-force values (reduces noise from GPS jitter)
  smoothField(samples, 'Lat G', 5);
  smoothField(samples, 'Lon G', 5);
  
  // Add G-force field mappings
  const gForceFields: FieldMapping[] = [
    { index: -10, name: 'Lat G', enabled: true },
    { index: -11, name: 'Lon G', enabled: true },
  ];
  fieldMappings.unshift(...gForceFields);

  // Add GGA-derived field mappings if we found GGA data
  if (hasGgaData) {
    // Check if any sample has GGA data
    const hasGgaInSamples = samples.some(s => 
      s.extraFields['Satellites'] !== undefined ||
      s.extraFields['HDOP'] !== undefined ||
      s.extraFields['Altitude (m)'] !== undefined
    );
    
    if (hasGgaInSamples) {
      // Add to beginning of field mappings for visibility
      const ggaFields: FieldMapping[] = [
        { index: -1, name: 'Satellites', enabled: true },
        { index: -2, name: 'HDOP', enabled: true },
        { index: -3, name: 'Altitude (m)', enabled: true },
      ];
      fieldMappings.unshift(...ggaFields);
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
    duration: samples[samples.length - 1].t
  };
}

// Parse CSV line using tab delimiter (0x09)
// NMEA sentences use commas internally, so we use tab as the field separator
function parseCSVLine(line: string): string[] {
  // Split by tab character
  const fields = line.split('\t');
  
  // Clean up each field - remove surrounding quotes and trim
  return fields.map(field => {
    let cleaned = field.trim();
    // Remove surrounding quotes if present
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.slice(1, -1);
    }
    return cleaned;
  });
}
