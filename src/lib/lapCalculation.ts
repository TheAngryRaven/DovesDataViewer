import { GpsSample, Course, Lap, LapCrossing, SectorTimes, SectorLine, CourseDirection } from '@/types/racing';
import { EARTH_RADIUS_M } from './parserUtils';
import { normalizeCourseSectors, majorSectorLines, rollupMajorSectors } from './courseSectors';

interface Point {
  x: number;
  y: number;
}

// Project lat/lon to local planar coordinates (equirectangular approximation)
function projectToPlane(lat: number, lon: number, centerLat: number, centerLon: number): Point {
  const x = (lon - centerLon) * Math.PI / 180 * EARTH_RADIUS_M * Math.cos(centerLat * Math.PI / 180);
  const y = (lat - centerLat) * Math.PI / 180 * EARTH_RADIUS_M;
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
  // 'sf' = start/finish; a number is the 0-based index into course.sectors.
  lineType: 'sf' | number;
  crossingTime: number;
  sampleIndex: number;
  fraction: number;
  direction: number; // 1 or -1
}

// Detect crossings for a specific line.
//
// Debouncing is tracked per-direction so that an early opposite-direction
// crossing (e.g., a GPS glitch on entry) does NOT lock out subsequent correct
// crossings. After collecting candidates, we keep only the majority direction.
function detectLineCrossings(
  samples: GpsSample[],
  lineA: Point,
  lineB: Point,
  centerLat: number,
  centerLon: number,
  lineType: 'sf' | number,
  minInterval: number
): LineCrossing[] {
  const candidates: LineCrossing[] = [];
  let lastForwardTime = -minInterval;
  let lastReverseTime = -minInterval;

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
      const direction = side2 > side1 ? 1 : -1;
      const lastTime = direction === 1 ? lastForwardTime : lastReverseTime;

      if (crossingTime - lastTime >= minInterval) {
        candidates.push({ lineType, crossingTime, sampleIndex: i, fraction, direction });
        if (direction === 1) lastForwardTime = crossingTime;
        else lastReverseTime = crossingTime;
      }
    }
  }

  if (candidates.length === 0) return [];

  // Majority-direction filter: a single wrong-direction glitch is discarded.
  // Ties resolve to direction=1 (arbitrary but deterministic).
  let forwardCount = 0;
  let reverseCount = 0;
  for (const c of candidates) {
    if (c.direction === 1) forwardCount++;
    else reverseCount++;
  }
  const winningDirection = forwardCount >= reverseCount ? 1 : -1;
  return candidates.filter(c => c.direction === winningDirection);
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

export function calculateLaps(samples: GpsSample[], inputCourse: Course): Lap[] {
  if (samples.length < 2) return [];

  // Operate on the canonical sector model regardless of how the course was stored.
  const course = normalizeCourseSectors(inputCourse);

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

  // Detect crossings for every sector line in course order (index-tagged).
  const courseSectors = course.sectors ?? [];
  const sectorCrossings: LineCrossing[][] = courseSectors.map((sec, j) => {
    const line = projectSectorLine(sec.line, centerLat, centerLon);
    return detectLineCrossings(samples, line.a, line.b, centerLat, centerLon, j, MIN_SECTOR_CROSSING_INTERVAL_MS);
  });
  // Number of timing lines = start/finish + course sectors. Segment k spans
  // line k → line k+1 (last segment wraps back to start/finish).
  const lineCount = courseSectors.length + 1;

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
    
    // Compute fine-grained per-segment times when the course defines sectors.
    let sectors: SectorTimes | undefined;
    let sectorTimes: (number | undefined)[] | undefined;
    let sectorBoundaries: (number | undefined)[] | undefined;

    if (courseSectors.length > 0) {
      // Walk every sector line in order, finding the crossing for this lap. Each
      // must fall after the previously matched boundary so out-of-order/missed
      // crossings leave a gap rather than corrupting later sectors.
      const boundaryTimes: (number | undefined)[] = new Array(lineCount);
      const boundaryIdx: (number | undefined)[] = new Array(lineCount);
      boundaryTimes[0] = start.crossingTime; // line 0 = start/finish
      boundaryIdx[0] = start.sampleIndex;
      let prevTime = start.crossingTime;

      for (let j = 0; j < courseSectors.length; j++) {
        const cross = sectorCrossings[j].find(
          c => c.crossingTime > prevTime && c.crossingTime < end.crossingTime,
        );
        if (cross) {
          boundaryTimes[j + 1] = cross.crossingTime;
          boundaryIdx[j + 1] = cross.sampleIndex;
          prevTime = cross.crossingTime;
        } else {
          boundaryTimes[j + 1] = undefined;
          boundaryIdx[j + 1] = undefined;
        }
      }

      // Segment k = boundary k → boundary k+1 (last segment closes on start/finish).
      sectorTimes = new Array(lineCount);
      for (let k = 0; k < lineCount; k++) {
        const tStart = boundaryTimes[k];
        const tEnd = k + 1 < lineCount ? boundaryTimes[k + 1] : end.crossingTime;
        sectorTimes[k] = tStart !== undefined && tEnd !== undefined ? tEnd - tStart : undefined;
      }
      sectorBoundaries = boundaryIdx;
      sectors = rollupMajorSectors(course, sectorTimes);
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
      sectors,
      sectorTimes,
      sectorBoundaries
    });
  }
  
  return laps;
}

/**
 * Compute sector splits for ONE already-delimited lap whose samples span exactly
 * the lap (index 0 = lap start, last index = lap end) — e.g. a leaderboard entry
 * transposed from a snapshot. Unlike calculateLaps it does NOT re-detect the
 * start/finish crossing (the slice has no lead-in), it anchors the lap at the
 * slice ends and only locates the intermediate sector-line crossings. Boundary
 * indices are relative to the passed `samples`. Returns empty when the course
 * defines no sectors. Mirrors the per-lap sector logic in calculateLaps.
 */
export function computeLapSectors(
  samples: GpsSample[],
  inputCourse: Course,
): { sectors?: SectorTimes; sectorTimes?: (number | undefined)[]; sectorBoundaries?: (number | undefined)[] } {
  if (samples.length < 2) return {};
  const course = normalizeCourseSectors(inputCourse);
  const courseSectors = course.sectors ?? [];
  if (courseSectors.length === 0) return {};

  const centerLat = (course.startFinishA.lat + course.startFinishB.lat) / 2;
  const centerLon = (course.startFinishA.lon + course.startFinishB.lon) / 2;

  const startT = samples[0].t;
  const endT = samples[samples.length - 1].t;
  const lineCount = courseSectors.length + 1;

  const boundaryTimes: (number | undefined)[] = new Array(lineCount);
  const boundaryIdx: (number | undefined)[] = new Array(lineCount);
  boundaryTimes[0] = startT; // line 0 = start/finish = the slice start
  boundaryIdx[0] = 0;
  let prevTime = startT;

  for (let j = 0; j < courseSectors.length; j++) {
    const line = projectSectorLine(courseSectors[j].line, centerLat, centerLon);
    const crossings = detectLineCrossings(
      samples, line.a, line.b, centerLat, centerLon, j, MIN_SECTOR_CROSSING_INTERVAL_MS,
    );
    const cross = crossings.find((c) => c.crossingTime > prevTime && c.crossingTime < endT);
    if (cross) {
      boundaryTimes[j + 1] = cross.crossingTime;
      boundaryIdx[j + 1] = cross.sampleIndex;
      prevTime = cross.crossingTime;
    } else {
      boundaryTimes[j + 1] = undefined;
      boundaryIdx[j + 1] = undefined;
    }
  }

  const sectorTimes: (number | undefined)[] = new Array(lineCount);
  for (let k = 0; k < lineCount; k++) {
    const tStart = boundaryTimes[k];
    const tEnd = k + 1 < lineCount ? boundaryTimes[k + 1] : endT;
    sectorTimes[k] = tStart !== undefined && tEnd !== undefined ? tEnd - tStart : undefined;
  }
  return { sectors: rollupMajorSectors(course, sectorTimes), sectorTimes, sectorBoundaries: boundaryIdx };
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

// Calculate optimal lap from the best time of every fine-grained sector segment.
export interface OptimalLapResult {
  optimalTimeMs: number;
  /** Best (min) time for each segment, in course order. */
  bestSegments: number[];
  deltaToFastest: number; // fastest lap - optimal (should be >= 0)
}

/**
 * Optimal lap = sum of the fastest time achieved in each sector segment across
 * all laps (now over ALL sectors, not just the three majors). Returns null
 * unless every segment was completed in at least one lap.
 */
export function calculateOptimalLap(laps: Lap[]): OptimalLapResult | null {
  const lapsWithSegments = laps.filter(l => l.sectorTimes && l.sectorTimes.length > 0);
  if (lapsWithSegments.length === 0) return null;

  const segCount = Math.max(...lapsWithSegments.map(l => l.sectorTimes!.length));
  const bestSegments = new Array<number>(segCount).fill(Infinity);

  for (const lap of lapsWithSegments) {
    lap.sectorTimes!.forEach((t, k) => {
      if (t !== undefined && t < bestSegments[k]) bestSegments[k] = t;
    });
  }

  // Every segment needs at least one completed lap to form a complete optimal.
  if (bestSegments.some(b => !isFinite(b))) return null;

  const optimalTimeMs = bestSegments.reduce((a, b) => a + b, 0);

  // Find fastest actual lap (single-pass to avoid stack overflow on huge inputs)
  let fastestLapMs = Infinity;
  for (const l of laps) {
    if (l.lapTimeMs < fastestLapMs) fastestLapMs = l.lapTimeMs;
  }
  const deltaToFastest = fastestLapMs - optimalTimeMs;

  return { optimalTimeMs, bestSegments, deltaToFastest };
}

/**
 * Determine the temporal order of S2 vs S3 crossings to infer driving direction.
 *
 * Unlike sector times in calculateLaps (which require S2→S3 in order to compute
 * any sectors at all), this function looks at the FIRST crossing of each sector
 * line regardless of order, and reports which line was hit first. This works
 * even when the racing line never produces a valid sector-times triple — e.g.,
 * when only one of S2/S3 falls on the racing line, or when GPS sample rate is
 * too low to consistently catch crossings.
 *
 * Returns:
 *   - 'forward' if S2 is crossed before S3
 *   - 'reverse' if S3 is crossed before S2
 *   - undefined if either line is never crossed, or the course has no sectors
 */
export function detectSectorOrder(samples: GpsSample[], inputCourse: Course): CourseDirection | undefined {
  const course = normalizeCourseSectors(inputCourse);
  // Direction is inferred from the first two major lines after start/finish.
  const majors = majorSectorLines(course);
  if (majors.length < 2 || samples.length < 2) {
    return undefined;
  }

  const centerLat = (course.startFinishA.lat + course.startFinishB.lat) / 2;
  const centerLon = (course.startFinishA.lon + course.startFinishB.lon) / 2;

  const s2Line = projectSectorLine(majors[0], centerLat, centerLon);
  const s3Line = projectSectorLine(majors[1], centerLat, centerLon);

  const firstS2Time = findFirstCrossingTime(samples, s2Line, centerLat, centerLon);
  const firstS3Time = findFirstCrossingTime(samples, s3Line, centerLat, centerLon);

  if (firstS2Time === null || firstS3Time === null) return undefined;
  return firstS2Time < firstS3Time ? 'forward' : 'reverse';
}

/** Find the time of the first crossing of a line by the sample path, regardless of direction. */
function findFirstCrossingTime(
  samples: GpsSample[],
  line: { a: Point; b: Point },
  centerLat: number,
  centerLon: number,
): number | null {
  for (let i = 0; i < samples.length - 1; i++) {
    const s1 = samples[i];
    const s2 = samples[i + 1];
    const p1 = projectToPlane(s1.lat, s1.lon, centerLat, centerLon);
    const p2 = projectToPlane(s2.lat, s2.lon, centerLat, centerLon);
    const fraction = segmentIntersection(p1, p2, line.a, line.b);
    if (fraction !== null && fraction >= 0 && fraction <= 1) {
      return s1.t + fraction * (s2.t - s1.t);
    }
  }
  return null;
}