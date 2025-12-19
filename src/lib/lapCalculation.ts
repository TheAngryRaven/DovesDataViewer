import { GpsSample, Track, Lap, LapCrossing } from '@/types/racing';

interface Point {
  x: number;
  y: number;
}

// Project lat/lon to local planar coordinates (equirectangular approximation)
function projectToPlane(lat: number, lon: number, centerLat: number, centerLon: number): Point {
  const R = 6371000; // Earth radius in meters
  const x = (lon - centerLon) * Math.PI / 180 * R * Math.cos(centerLat * Math.PI / 180);
  const y = (lat - centerLat) * Math.PI / 180 * R;
  return { x, y };
}

// Cross product of vectors OA and OB
function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// Check which side of line AB point P is on
// Returns: positive = left, negative = right, 0 = on line
function sideOfLine(p: Point, a: Point, b: Point): number {
  return cross(a, b, p);
}

// Line segment intersection
// Returns intersection fraction along segment p1->p2 if intersects, null otherwise
function segmentIntersection(
  p1: Point, p2: Point,  // GPS path segment
  a: Point, b: Point     // Start/finish line
): number | null {
  const d1 = sideOfLine(p1, a, b);
  const d2 = sideOfLine(p2, a, b);
  
  // Both points on same side = no crossing
  if ((d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0)) {
    return null;
  }
  
  // Check if start/finish line crosses the path segment
  const d3 = sideOfLine(a, p1, p2);
  const d4 = sideOfLine(b, p1, p2);
  
  if ((d3 > 0 && d4 > 0) || (d3 < 0 && d4 < 0)) {
    return null;
  }
  
  // Collinear case - ignore (treat as no crossing for lap timing)
  if (d1 === 0 && d2 === 0) {
    return null;
  }
  
  // Calculate intersection fraction along p1->p2
  const denom = d1 - d2;
  if (Math.abs(denom) < 1e-10) return null;
  
  const fraction = d1 / denom;
  return fraction;
}

// Minimum time between lap crossings (debounce)
const MIN_CROSSING_INTERVAL_MS = 5000; // 5 seconds

export function calculateLaps(samples: GpsSample[], track: Track): Lap[] {
  if (samples.length < 2) return [];
  
  // Calculate center for projection
  const centerLat = (track.startFinishA.lat + track.startFinishB.lat) / 2;
  const centerLon = (track.startFinishA.lon + track.startFinishB.lon) / 2;
  
  // Project start/finish line
  const sfA = projectToPlane(track.startFinishA.lat, track.startFinishA.lon, centerLat, centerLon);
  const sfB = projectToPlane(track.startFinishB.lat, track.startFinishB.lon, centerLat, centerLon);
  
  // Find all crossings
  const crossings: LapCrossing[] = [];
  let lastCrossingTime = -MIN_CROSSING_INTERVAL_MS;
  let lastCrossingSide = 0;
  
  for (let i = 0; i < samples.length - 1; i++) {
    const s1 = samples[i];
    const s2 = samples[i + 1];
    
    const p1 = projectToPlane(s1.lat, s1.lon, centerLat, centerLon);
    const p2 = projectToPlane(s2.lat, s2.lon, centerLat, centerLon);
    
    // Check which side of line each point is on
    const side1 = sideOfLine(p1, sfA, sfB);
    const side2 = sideOfLine(p2, sfA, sfB);
    
    // Check for intersection
    const fraction = segmentIntersection(p1, p2, sfA, sfB);
    
    if (fraction !== null && fraction >= 0 && fraction <= 1) {
      // Calculate crossing time by interpolation
      const crossingTime = s1.t + fraction * (s2.t - s1.t);
      
      // Direction gate: require crossing from one specific side
      // Only count crossings that go from negative to positive (or vice versa consistently)
      const crossingDirection = side2 > side1 ? 1 : -1;
      
      // Debounce: ignore crossings too close together
      if (crossingTime - lastCrossingTime >= MIN_CROSSING_INTERVAL_MS) {
        // For first crossing, accept any direction
        // For subsequent, require same direction (consistent lap direction)
        if (crossings.length === 0 || lastCrossingSide === 0 || crossingDirection === lastCrossingSide) {
          crossings.push({
            sampleIndex: i,
            crossingTime,
            fraction
          });
          lastCrossingTime = crossingTime;
          lastCrossingSide = crossingDirection;
        }
      }
    }
  }
  
  // Calculate laps from crossings
  const laps: Lap[] = [];
  
  for (let i = 0; i < crossings.length - 1; i++) {
    const start = crossings[i];
    const end = crossings[i + 1];
    
    const lapTimeMs = end.crossingTime - start.crossingTime;
    
    // Find max and min speed in this lap
    // We use a small threshold for min speed to filter out GPS glitches where speed briefly reports as 0
    const MIN_SPEED_THRESHOLD_MPH = 1.0; // Speeds below this are likely GPS artifacts during racing
    
    let maxSpeedMph = 0;
    let maxSpeedKph = 0;
    let minSpeedMph = Infinity;
    let minSpeedKph = Infinity;
    
    for (let j = start.sampleIndex; j <= end.sampleIndex && j < samples.length; j++) {
      const sample = samples[j];
      
      if (sample.speedMph > maxSpeedMph) {
        maxSpeedMph = sample.speedMph;
        maxSpeedKph = sample.speedKph;
      }
      
      // Only consider speeds above threshold for min calculation
      // This filters out GPS glitches that report 0 speed momentarily
      if (sample.speedMph >= MIN_SPEED_THRESHOLD_MPH && sample.speedMph < minSpeedMph) {
        minSpeedMph = sample.speedMph;
        minSpeedKph = sample.speedKph;
      }
    }
    
    laps.push({
      lapNumber: i + 1,
      startTime: start.crossingTime,
      endTime: end.crossingTime,
      lapTimeMs,
      maxSpeedMph,
      maxSpeedKph,
      minSpeedMph: minSpeedMph === Infinity ? 0 : minSpeedMph,
      minSpeedKph: minSpeedKph === Infinity ? 0 : minSpeedKph,
      startIndex: start.sampleIndex,
      endIndex: end.sampleIndex
    });
  }
  
  return laps;
}

// Format lap time as mm:ss.sss
export function formatLapTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
}
