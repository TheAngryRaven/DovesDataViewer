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

interface ParsedNmea {
  lat: number;
  lon: number;
  timeMs: number; // ms since midnight
  speedMps: number | null;
  date: { day: number; month: number; year: number } | null;
  valid: boolean;
  satellites?: number;
  hdop?: number;
}

function parseNmeaSentence(sentence: string): ParsedNmea | null {
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
  const speedKnots = parseFloat(parts[7]) || 0;
  const date = parseNmeaDate(parts[9]);
  
  const timeMs = (time.hours * 3600 + time.minutes * 60 + time.seconds) * 1000 + time.ms;
  
  return {
    lat,
    lon,
    timeMs,
    speedMps: knotsToMps(speedKnots),
    date,
    valid: true
  };
}

// Calculate speed from two GPS points with sanity checks
function calculateSpeed(lat1: number, lon1: number, t1: number, lat2: number, lon2: number, t2: number): number | null {
  const timeDiff = (t2 - t1) / 1000; // seconds
  
  // Need at least 50ms time difference to calculate speed reliably
  if (timeDiff < 0.05) return null;
  
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  const speedMps = distance / timeDiff;
  
  // Sanity check: max reasonable speed is ~150 m/s (~335 mph) for race cars
  // Anything above this is likely GPS glitch
  if (speedMps > 150) return null;
  
  return speedMps;
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

  const samples: GpsSample[] = [];
  const fieldMappings: FieldMapping[] = [];
  let fieldMappingsCreated = false;
  
  let baseTimeMs = 0;
  let lastTimeMs = 0;
  let dayOffset = 0;

  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    if (fields.length === 0) continue;

    // First field should be NMEA sentence
    const nmeaSentence = fields[0];
    const parsed = parseNmeaSentence(nmeaSentence);
    
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

    // Parse extra fields
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

    samples.push({
      t,
      lat: parsed.lat,
      lon: parsed.lon,
      speedMps,
      speedMph: speedMps * 2.23694,
      speedKph: speedMps * 3.6,
      rawNmea: nmeaSentence,
      extraFields
    });
  }

  if (samples.length === 0) {
    throw new Error('No valid GPS data found in file');
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
