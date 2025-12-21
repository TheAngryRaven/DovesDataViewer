import { GpsSample, Course, Lap, LapCrossing, SectorTimes, SectorLine, courseHasSectors } from '@/types/racing';

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
  a: Point, b: Point     // Timing line
): number | null {
  const d1 = sideOfLine(p1, a, b);
  const d2 = sideOfLine(p2, a, b);
  
  // Both points on same side = no crossing
  if ((d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0)) {
    return null;
  }
  
  // Check if timing line crosses the path segment
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

// Minimum time between crossings of the same line (debounce)
const MIN_CROSSING_INTERVAL_MS = 5000; // 5 seconds for start/finish
const MIN_SECTOR_CROSSING_INTERVAL_MS = 1000; // 1 second for sector lines

interface LineCrossing {
  lineType: 'sf' | 's2' | 's3'; // start/finish, sector2, sector3
  crossingTime: number;
  sampleIndex: number;
  fraction: number;
  direction: number; // 1 or -1
}

// Detect crossings for a specific line
function detectLineCrossings(
  samples: GpsSample[],
  lineA: Point,
  lineB: Point,
  centerLat: number,
  centerLon: number,
  lineType: 'sf' | 's2' | 's3',
  minInterval: number
): LineCrossing[] {
  const crossings: LineCrossing[] = [];
  let lastCrossingTime = -minInterval;
  let lastCrossingDirection = 0;

  for (let i = 0; i < samples.length - 1; i++) {
    const s1 = samples[i];
    const s2 = samples[i + 1];
    
    const p1 = projectToPlane(s1.lat, s1.lon, centerLat, centerLon);
    const p2 = projectToPlane(s2.lat, s2.lon, centerLat, centerLon);
    
    const side1 = sideOfLine(p1, lineA, lineB);
    const side2 = sideOfLine(p2, lineA, lineB);
    
    const fraction = segmentIntersection(p1, p2, lineA, lineB);
    
    if (fraction !== null && fraction >= 0 && fraction <= 1) {
      const crossingTime = s1.t + fraction * (s2.t - s1.t);
      const crossingDirection = side2 > side1 ? 1 : -1;
      
      if (crossingTime - lastCrossingTime >= minInterval) {
        // For first crossing, accept any direction
        // For subsequent, require same direction (consistent lap direction)
        if (crossings.length === 0 || lastCrossingDirection === 0 || crossingDirection === lastCrossingDirection) {
          crossings.push({
            lineType,
            crossingTime,
            sampleIndex: i,
            fraction,
            direction: crossingDirection
          });
          lastCrossingTime = crossingTime;
          lastCrossingDirection = crossingDirection;
        }
      }
    }
  }
  
  return crossings;
}

// Project a sector line to planar coordinates
function projectSectorLine(
  sectorLine: SectorLine,
  centerLat: number,
  centerLon: number
): { a: Point; b: Point } {
  return {
    a: projectToPlane(sectorLine.a.lat, sectorLine.a.lon, centerLat, centerLon),
    b: projectToPlane(sectorLine.b.lat, sectorLine.b.lon, centerLat, centerLon)
  };
}

export function calculateLaps(samples: GpsSample[], course: Course): Lap[] {
  if (samples.length < 2) return [];
  
  // Calculate center for projection
  const centerLat = (course.startFinishA.lat + course.startFinishB.lat) / 2;
  const centerLon = (course.startFinishA.lon + course.startFinishB.lon) / 2;
  
  // Project start/finish line
  const sfA = projectToPlane(course.startFinishA.lat, course.startFinishA.lon, centerLat, centerLon);
  const sfB = projectToPlane(course.startFinishB.lat, course.startFinishB.lon, centerLat, centerLon);
  
  // Detect start/finish crossings
  const sfCrossings = detectLineCrossings(samples, sfA, sfB, centerLat, centerLon, 'sf', MIN_CROSSING_INTERVAL_MS);
  
  // Convert to LapCrossing format for backwards compatibility
  const crossings: LapCrossing[] = sfCrossings.map(c => ({
    sampleIndex: c.sampleIndex,
    crossingTime: c.crossingTime,
    fraction: c.fraction
  }));
  
  // Detect sector crossings only if course has both sector lines
  const hasSectors = courseHasSectors(course);
  let sector2Crossings: LineCrossing[] = [];
  let sector3Crossings: LineCrossing[] = [];
  
  if (hasSectors && course.sector2 && course.sector3) {
    const s2Line = projectSectorLine(course.sector2, centerLat, centerLon);
    const s3Line = projectSectorLine(course.sector3, centerLat, centerLon);
    
    sector2Crossings = detectLineCrossings(samples, s2Line.a, s2Line.b, centerLat, centerLon, 's2', MIN_SECTOR_CROSSING_INTERVAL_MS);
    sector3Crossings = detectLineCrossings(samples, s3Line.a, s3Line.b, centerLat, centerLon, 's3', MIN_SECTOR_CROSSING_INTERVAL_MS);
  }
  
  // Calculate laps from crossings
  const laps: Lap[] = [];
  
  for (let i = 0; i < crossings.length - 1; i++) {
    const start = crossings[i];
    const end = crossings[i + 1];
    
    const lapTimeMs = end.crossingTime - start.crossingTime;
    
    // Find max and min speed in this lap with glitch filtering
    const MIN_SPEED_THRESHOLD_MPH = 1.0;
    const MAX_GLITCH_SAMPLES = 3;
    
    const glitchIndices = new Set<number>();
    let runStart = -1;
    
    for (let j = start.sampleIndex; j <= end.sampleIndex && j < samples.length; j++) {
      const isLowSpeed = samples[j].speedMph < MIN_SPEED_THRESHOLD_MPH;
      
      if (isLowSpeed && runStart === -1) {
        runStart = j;
      } else if (!isLowSpeed && runStart !== -1) {
        const runLength = j - runStart;
        if (runLength <= MAX_GLITCH_SAMPLES) {
          for (let k = runStart; k < j; k++) {
            glitchIndices.add(k);
          }
        }
        runStart = -1;
      }
    }
    if (runStart !== -1) {
      const runLength = (end.sampleIndex + 1) - runStart;
      if (runLength <= MAX_GLITCH_SAMPLES) {
        for (let k = runStart; k <= end.sampleIndex && k < samples.length; k++) {
          glitchIndices.add(k);
        }
      }
    }
    
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
      
      if (!glitchIndices.has(j) && sample.speedMph < minSpeedMph) {
        minSpeedMph = sample.speedMph;
        minSpeedKph = sample.speedKph;
      }
    }
    
    // Calculate sector times if sectors exist
    let sectors: SectorTimes | undefined;
    
    if (hasSectors) {
      // Find sector2 crossing within this lap (after start.crossingTime, before end.crossingTime)
      const s2Crossing = sector2Crossings.find(c => 
        c.crossingTime > start.crossingTime && c.crossingTime < end.crossingTime
      );
      
      // Find sector3 crossing within this lap (after sector2 if found, before end.crossingTime)
      const s3Crossing = sector3Crossings.find(c => 
        c.crossingTime > (s2Crossing?.crossingTime ?? start.crossingTime) && 
        c.crossingTime < end.crossingTime
      );
      
      // Only compute sector times if crossings are in correct order
      if (s2Crossing && s3Crossing && s2Crossing.crossingTime < s3Crossing.crossingTime) {
        sectors = {
          s1: s2Crossing.crossingTime - start.crossingTime,
          s2: s3Crossing.crossingTime - s2Crossing.crossingTime,
          s3: end.crossingTime - s3Crossing.crossingTime
        };
      } else if (s2Crossing && !s3Crossing) {
        // Only S1 is valid
        sectors = {
          s1: s2Crossing.crossingTime - start.crossingTime,
          s2: undefined,
          s3: undefined
        };
      } else if (!s2Crossing && s3Crossing) {
        // S1 and S2 missing, S3 can't be computed alone
        sectors = {
          s1: undefined,
          s2: undefined,
          s3: undefined
        };
      } else {
        // No sector crossings found
        sectors = {
          s1: undefined,
          s2: undefined,
          s3: undefined
        };
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
      endIndex: end.sampleIndex,
      sectors
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

// Format sector time as ss.sss (shorter format)
export function formatSectorTime(ms: number): string {
  const seconds = ms / 1000;
  return seconds.toFixed(3);
}

// Calculate optimal lap from best sectors
export interface OptimalLapResult {
  optimalTimeMs: number;
  bestS1: number;
  bestS2: number;
  bestS3: number;
  deltaToFastest: number; // fastest lap - optimal (should be >= 0)
}

export function calculateOptimalLap(laps: Lap[]): OptimalLapResult | null {
  // Filter laps that have all three valid sector times
  const lapsWithAllSectors = laps.filter(lap => 
    lap.sectors?.s1 !== undefined && 
    lap.sectors?.s2 !== undefined && 
    lap.sectors?.s3 !== undefined
  );
  
  if (lapsWithAllSectors.length === 0) return null;
  
  // Find best time for each sector
  let bestS1 = Infinity;
  let bestS2 = Infinity;
  let bestS3 = Infinity;
  
  for (const lap of lapsWithAllSectors) {
    if (lap.sectors!.s1! < bestS1) bestS1 = lap.sectors!.s1!;
    if (lap.sectors!.s2! < bestS2) bestS2 = lap.sectors!.s2!;
    if (lap.sectors!.s3! < bestS3) bestS3 = lap.sectors!.s3!;
  }
  
  const optimalTimeMs = bestS1 + bestS2 + bestS3;
  
  // Find fastest actual lap
  const fastestLapMs = Math.min(...laps.map(l => l.lapTimeMs));
  const deltaToFastest = fastestLapMs - optimalTimeMs;
  
  return {
    optimalTimeMs,
    bestS1,
    bestS2,
    bestS3,
    deltaToFastest
  };
}