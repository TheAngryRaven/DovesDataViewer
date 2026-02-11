import { GpsSample, FieldMapping, ParsedData } from '@/types/racing';
import { applyGForceCalculations } from './gforceCalculation';
import { haversineDistance, isTeleportation, MAX_SPEED_MPS } from './parserUtils';

/**
 * VBO Parser for Racelogic VBOX data files
 * 
 * VBO format structure:
 * - [header] section with metadata
 * - [column names] section with channel names
 * - [data] section with space-delimited rows
 * 
 * Standard VBO columns include:
 * - sats, time, lat, long, velocity, heading, height, etc.
 */

// Check if content is VBO format by looking for characteristic sections
export function isVboFormat(content: string): boolean {
  const lowerContent = content.substring(0, 2000).toLowerCase();
  return (
    lowerContent.includes('[header]') ||
    lowerContent.includes('[column names]') ||
    lowerContent.includes('[data]')
  );
}

interface VboColumnInfo {
  name: string;
  index: number;
}

// Standard VBO column mappings (case-insensitive)
const KNOWN_COLUMNS: Record<string, string> = {
  'sats': 'Satellites',
  'satellites': 'Satellites',
  'time': 'time',
  'lat': 'lat',
  'latitude': 'lat',
  'long': 'lon',
  'lon': 'lon',
  'longitude': 'lon',
  'velocity': 'velocity', // km/h in VBO
  'speed': 'velocity',
  'velocity kmh': 'velocity',
  'heading': 'heading',
  'height': 'height', // meters
  'altitude': 'height',
  'vert vel': 'vertVel',
  'vertical velocity': 'vertVel',
  'long accel': 'lonAccel', // g
  'lateral accel': 'latAccel', // g
  'lat accel': 'latAccel',
  'longitudinal accel': 'lonAccel',
  'yaw rate': 'yawRate',
  'slip': 'slip',
  'slip angle': 'slip',
  'distance': 'distance',
};

// Parse VBO time format (hhmmss.sss or seconds since midnight)
function parseVboTime(value: string): number {
  const num = parseFloat(value);
  if (isNaN(num)) return 0;
  
  // Check if it's hhmmss.sss format (larger than 86400 would be impossible for seconds)
  // or if it contains more than 6 digits before decimal
  if (num >= 100000) {
    // hhmmss.sss format
    const str = value.padStart(10, '0');
    const hours = parseInt(str.substring(0, 2), 10);
    const minutes = parseInt(str.substring(2, 4), 10);
    const secondsStr = str.substring(4);
    const seconds = parseFloat(secondsStr);
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }
  
  // Already in seconds since midnight
  return num * 1000;
}

// Parse VBO coordinate - may be in decimal degrees or NMEA format
function parseVboCoordinate(value: string): number {
  const num = parseFloat(value);
  if (isNaN(num)) return 0;
  
  // VBO files typically use decimal minutes format: DDDMM.MMMMM
  // Check if this looks like decimal minutes (absolute value > 100 for lon, > 90 for lat usually)
  // But RaceBox exports decimal degrees directly
  
  // If absolute value is reasonable for decimal degrees, use directly
  if (Math.abs(num) <= 180) {
    return num;
  }
  
  // Otherwise, convert from DDDMM.MMMMM format
  const sign = num < 0 ? -1 : 1;
  const absNum = Math.abs(num);
  const degrees = Math.floor(absNum / 100);
  const minutes = absNum - degrees * 100;
  return sign * (degrees + minutes / 60);
}

export function parseVboFile(content: string): ParsedData {
  const lines = content.split(/\r?\n/);
  
  // Find section markers
  let headerStart = -1;
  let columnNamesStart = -1;
  let dataStart = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().toLowerCase();
    if (line === '[header]') headerStart = i;
    else if (line === '[column names]') columnNamesStart = i;
    else if (line === '[data]') dataStart = i;
  }
  
  if (dataStart === -1) {
    throw new Error('No [data] section found in VBO file');
  }
  
  // Parse column names
  const columns: VboColumnInfo[] = [];
  const columnLine = columnNamesStart >= 0 && columnNamesStart < dataStart
    ? lines.slice(columnNamesStart + 1, dataStart).find(l => l.trim().length > 0)
    : null;
  
  if (columnLine) {
    // Split by whitespace, but handle multi-word column names
    // VBO typically uses space-delimited single words
    const colNames = columnLine.trim().split(/\s+/);
    for (let i = 0; i < colNames.length; i++) {
      columns.push({ name: colNames[i], index: i });
    }
  }
  
  // Map column indices to known fields
  const columnMap: Record<string, number> = {};
  for (const col of columns) {
    const normalized = KNOWN_COLUMNS[col.name.toLowerCase()];
    if (normalized) {
      columnMap[normalized] = col.index;
    }
  }
  
  // Parse data rows
  const samples: GpsSample[] = [];
  let baseTimeMs: number | null = null;
  let startDate: Date | undefined;
  
  for (let i = dataStart + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('[')) continue; // Skip empty lines and section headers
    
    const fields = line.split(/\s+/);
    if (fields.length < 3) continue;
    
    // Extract core fields
    const latIdx = columnMap['lat'];
    const lonIdx = columnMap['lon'];
    const timeIdx = columnMap['time'];
    const velIdx = columnMap['velocity'];
    const headingIdx = columnMap['heading'];
    
    // Must have at least lat/lon
    if (latIdx === undefined || lonIdx === undefined) {
      // Try positional defaults: sats, time, lat, long, velocity, heading, height...
      // This is the standard VBOX order
      if (fields.length >= 5) {
        columnMap['Satellites'] = 0;
        columnMap['time'] = 1;
        columnMap['lat'] = 2;
        columnMap['lon'] = 3;
        columnMap['velocity'] = 4;
        if (fields.length > 5) columnMap['heading'] = 5;
        if (fields.length > 6) columnMap['height'] = 6;
      } else {
        continue;
      }
    }
    
    const lat = parseVboCoordinate(fields[columnMap['lat']]);
    const lon = parseVboCoordinate(fields[columnMap['lon']]);
    
    // Skip invalid coordinates
    if (lat === 0 || lon === 0 || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      continue;
    }
    
    // Parse time
    let timeMs = 0;
    if (columnMap['time'] !== undefined && fields[columnMap['time']]) {
      timeMs = parseVboTime(fields[columnMap['time']]);
    }
    
    if (baseTimeMs === null) {
      baseTimeMs = timeMs;
    }
    
    let t = timeMs - baseTimeMs;
    if (t < 0) t += 86400000; // Handle midnight wrap
    
    // Parse velocity (VBO uses km/h)
    let speedKph = 0;
    if (columnMap['velocity'] !== undefined && fields[columnMap['velocity']]) {
      speedKph = parseFloat(fields[columnMap['velocity']]) || 0;
    }
    const speedMps = speedKph / 3.6;
    
    // Sanity check on speed
    if (speedMps > MAX_SPEED_MPS) continue;

    // Parse heading
    let heading: number | undefined;
    if (columnMap['heading'] !== undefined && fields[columnMap['heading']]) {
      heading = parseFloat(fields[columnMap['heading']]);
      if (isNaN(heading)) heading = undefined;
      else {
        // Normalize to 0-360
        while (heading < 0) heading += 360;
        while (heading >= 360) heading -= 360;
      }
    }
    
    // Teleportation filter
    if (samples.length > 0) {
      const prev = samples[samples.length - 1];
      if (isTeleportation(prev.lat, prev.lon, prev.t, lat, lon, t, 'VBO')) continue;
    }
    
    // Build extra fields
    const extraFields: Record<string, number> = {};
    
    // Add satellites if present
    if (columnMap['Satellites'] !== undefined && fields[columnMap['Satellites']]) {
      const sats = parseInt(fields[columnMap['Satellites']], 10);
      if (!isNaN(sats)) extraFields['Satellites'] = sats;
    }
    
    // Add height/altitude if present
    if (columnMap['height'] !== undefined && fields[columnMap['height']]) {
      const height = parseFloat(fields[columnMap['height']]);
      if (!isNaN(height)) extraFields['Altitude (m)'] = height;
    }
    
    // Add native accelerometer data if present (already in G)
    if (columnMap['latAccel'] !== undefined && fields[columnMap['latAccel']]) {
      const latAccel = parseFloat(fields[columnMap['latAccel']]);
      if (!isNaN(latAccel)) extraFields['Lat G (Native)'] = latAccel;
    }
    
    if (columnMap['lonAccel'] !== undefined && fields[columnMap['lonAccel']]) {
      const lonAccel = parseFloat(fields[columnMap['lonAccel']]);
      if (!isNaN(lonAccel)) extraFields['Lon G (Native)'] = lonAccel;
    }
    
    // Add yaw rate if present
    if (columnMap['yawRate'] !== undefined && fields[columnMap['yawRate']]) {
      const yawRate = parseFloat(fields[columnMap['yawRate']]);
      if (!isNaN(yawRate)) extraFields['Yaw Rate'] = yawRate;
    }
    
    // Add distance if present
    if (columnMap['distance'] !== undefined && fields[columnMap['distance']]) {
      const distance = parseFloat(fields[columnMap['distance']]);
      if (!isNaN(distance)) extraFields['Distance'] = distance;
    }
    
    samples.push({
      t,
      lat,
      lon,
      speedMps,
      speedMph: speedMps * 2.23694,
      speedKph,
      heading,
      extraFields
    });
  }
  
  if (samples.length === 0) {
    throw new Error('No valid GPS data found in VBO file');
  }
  
  // Calculate G-forces from GPS data
  applyGForceCalculations(samples, 5);
  
  // Build field mappings
  const fieldMappings: FieldMapping[] = [
    { index: -10, name: 'Lat G', enabled: true },
    { index: -11, name: 'Lon G', enabled: true },
  ];
  
  // Add native G fields if they exist
  if (samples.some(s => s.extraFields['Lat G (Native)'] !== undefined)) {
    fieldMappings.push({ index: -12, name: 'Lat G (Native)', enabled: true });
  }
  if (samples.some(s => s.extraFields['Lon G (Native)'] !== undefined)) {
    fieldMappings.push({ index: -13, name: 'Lon G (Native)', enabled: true });
  }
  
  // Add other standard fields if present
  if (samples.some(s => s.extraFields['Satellites'] !== undefined)) {
    fieldMappings.push({ index: -1, name: 'Satellites', enabled: true });
  }
  if (samples.some(s => s.extraFields['Altitude (m)'] !== undefined)) {
    fieldMappings.push({ index: -3, name: 'Altitude (m)', enabled: true });
  }
  if (samples.some(s => s.extraFields['Yaw Rate'] !== undefined)) {
    fieldMappings.push({ index: -14, name: 'Yaw Rate', enabled: true });
  }
  if (samples.some(s => s.extraFields['Distance'] !== undefined)) {
    fieldMappings.push({ index: -15, name: 'Distance', enabled: true });
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
