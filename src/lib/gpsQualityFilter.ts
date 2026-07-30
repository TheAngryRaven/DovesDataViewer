/**
 * Post-parse GPS quality filter — runs once for every format, right after
 * `normalizeChannels()` in the datalog router, so errant points are voided
 * from every downstream feature (race line, laps, distance, speed stats,
 * charts, g-force, braking zones) at the single point they all draw from.
 *
 * Two passes:
 *
 * 1. **Quality gate (always on).** Drops samples whose own quality channels
 *    condemn them: physically impossible values (negative satellites/accuracy,
 *    DOP ≤ 0 — the logger provably wrote garbage) and weak fixes past the
 *    `DEFAULT_GPS_QUALITY_THRESHOLDS`. Signals are opt-in per sample — files
 *    without quality channels pass through untouched. If the weak-fix
 *    thresholds would reject the *entire* session (a marginal logger, not a
 *    corrupt one), the gate falls back to rejecting impossible values only —
 *    degraded data beats an unopenable file.
 *
 * 2. **Hardcore speed filtering (opt-in setting).** Position-jump
 *    (teleportation) rejection via a poison-proof anchor gate, plus speed
 *    *repair*: a sample whose reported speed is errant but whose position is
 *    fine keeps its position and gets speed recomputed locally from
 *    neighboring good fixes — the GPS may compute a garbage speed across an
 *    errant point, and dropping the whole packet would discard healthy data.
 *    Off by default because the implied-speed thresholds are kart-tuned.
 */

import { ParsedData, GpsSample, ParserStats } from '@/types/racing';
import {
  DEFAULT_GPS_QUALITY_THRESHOLDS,
  MAX_SPEED_MPS,
  accuracyUnitToMeters,
  calculateBounds,
  createRejectedCounter,
  createTeleportGate,
  haversineDistance,
  isLowQualityFix,
  speedTriple,
  type GpsQualityReading,
  type GpsQualityThresholds,
} from './parserUtils';

export interface GpsFilterOptions {
  /** Enable the speed-based pass (teleport rejection + speed repair). */
  hardcore?: boolean;
}

// Mirrors SETTINGS_KEY in hooks/useSettings.ts — kept as a literal so the pure
// lib layer doesn't import the React hooks bundle.
const SETTINGS_KEY = 'dove-dataviewer-settings';

/**
 * Read the persisted "hardcore GPS filtering" setting. The datalog router uses
 * this as the default when a caller doesn't pass an explicit option, so every
 * parse path (session load, overlays, reference laps, device downloads)
 * respects the user's choice without per-call-site plumbing.
 */
export function readHardcoreGpsFilteringSetting(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return false;
    return JSON.parse(stored)?.hardcoreGpsFiltering === true;
  } catch {
    return false;
  }
}

/** Fallback tier: only values the logger provably wrote as garbage reject
 *  (negative satellites/accuracy and DOP ≤ 0 are built into `isLowQualityFix`
 *  regardless of thresholds; satellites > 99 is physically impossible). */
const IMPOSSIBLE_ONLY_THRESHOLDS: GpsQualityThresholds = {
  minSatellites: 0,
  maxSatellites: 99,
  maxPosAccuracyM: Infinity,
  maxDop: Infinity,
};

// Quality-channel keys as they exist AFTER normalizeChannels(): canonical ids
// where the registry knows the name, `custom:` slugs where it doesn't. pDOP
// variants stay custom on purpose — pDOP is not HDOP and must not be
// mislabeled in the registry, but the DOP thresholds work for either.
const SATELLITE_KEYS = ['satellites'];
const DOP_KEYS = ['hdop', 'custom:gps_pdop', 'custom:gps_posdop', 'custom:gps_hdop', 'custom:pdop'];
const POS_ACCURACY_KEYS = [
  'h_acc',
  'custom:gps_posaccuracy',
  'custom:gps_pos_accuracy',
  'custom:gps_position_accuracy',
];

function firstPresentKey(fieldKeys: Set<string>, candidates: string[]): string | undefined {
  return candidates.find((k) => fieldKeys.has(k));
}

/**
 * Filter a freshly-parsed (and channel-normalized) session. Returns `data`
 * unchanged when nothing was dropped or repaired; otherwise returns a copy
 * with filtered samples, recomputed bounds/duration, and merged parser stats.
 */
export function filterGpsQuality(data: ParsedData, opts: GpsFilterOptions = {}): ParsedData {
  const { samples } = data;
  if (samples.length === 0) return data;

  const fieldKeys = new Set(data.fieldMappings.map((m) => m.name));
  const satKey = firstPresentKey(fieldKeys, SATELLITE_KEYS);
  const dopKey = firstPresentKey(fieldKeys, DOP_KEYS);
  const accKey = firstPresentKey(fieldKeys, POS_ACCURACY_KEYS);
  const accToMeters = accKey
    ? accuracyUnitToMeters(data.fieldMappings.find((m) => m.name === accKey)?.unit)
    : 1;

  const hasQualitySignals = satKey !== undefined || dopKey !== undefined || accKey !== undefined;
  if (!hasQualitySignals && !opts.hardcore) return data;

  const readingFor = (s: GpsSample): GpsQualityReading | null => {
    if (!hasQualitySignals) return null;
    const reading: GpsQualityReading = {};
    if (satKey !== undefined) reading.satellites = s.extraFields[satKey];
    if (dopKey !== undefined) reading.dop = s.extraFields[dopKey];
    if (accKey !== undefined) {
      const raw = s.extraFields[accKey];
      if (raw !== undefined) reading.posAccuracyM = raw * accToMeters;
    }
    return reading;
  };

  const runPasses = (thresholds: GpsQualityThresholds) => {
    // No formatName on the gate: a badly degraded session can reject thousands
    // of samples and per-sample console warnings would drown the console.
    const teleportGate = opts.hardcore ? createTeleportGate() : null;
    let lowQuality = 0;
    let teleportation = 0;
    const kept: GpsSample[] = [];
    for (const s of samples) {
      const reading = readingFor(s);
      if (reading && isLowQualityFix(reading, thresholds)) {
        lowQuality++;
        continue;
      }
      if (teleportGate && teleportGate.check(s.lat, s.lon, s.t)) {
        teleportation++;
        continue;
      }
      kept.push(s);
    }
    return { kept, lowQuality, teleportation };
  };

  let result = runPasses(DEFAULT_GPS_QUALITY_THRESHOLDS);
  if (result.kept.length === 0) {
    // The weak-fix thresholds rejected the whole session — a marginal logger,
    // not a corrupt file. Keep only the provably-garbage rejections.
    result = runPasses(IMPOSSIBLE_ONLY_THRESHOLDS);
  }
  const { kept, lowQuality, teleportation } = result;

  // Speed repair (hardcore): positions in `kept` are trusted now, so an errant
  // reported speed is recomputed from the neighboring fixes — local work only,
  // never a whole-file recompute.
  let repairedSpeeds = 0;
  if (opts.hardcore) {
    for (let i = 0; i < kept.length; i++) {
      const s = kept[i];
      if (Number.isFinite(s.speedMps) && s.speedMps >= 0 && s.speedMps <= MAX_SPEED_MPS) continue;
      const prev = i > 0 ? kept[i - 1] : undefined;
      const next = i + 1 < kept.length ? kept[i + 1] : undefined;
      const recomputed =
        impliedSpeed(prev, next) ?? impliedSpeed(prev, s) ?? impliedSpeed(s, next) ?? 0;
      kept[i] = { ...s, ...speedTriple(recomputed) };
      repairedSpeeds++;
    }
  }

  const dropped = lowQuality + teleportation;
  if (dropped === 0 && repairedSpeeds === 0) return data;
  if (kept.length === 0) {
    throw new Error(
      'Every GPS sample in this file is invalid — there are no usable fixes to display.',
    );
  }

  const parserStats = mergeStats(data.parserStats, samples.length, kept.length, {
    lowQuality,
    teleportation,
    repairedSpeeds,
  });

  return {
    ...data,
    samples: kept,
    bounds: calculateBounds(kept),
    // Timeline stays anchored at the original t0 (samples are not rebased),
    // so the duration only shrinks when trailing samples were dropped.
    duration: kept[kept.length - 1].t - samples[0].t,
    parserStats,
  };
}

/** Implied ground speed between two fixes, when both exist and dt is sane. */
function impliedSpeed(a: GpsSample | undefined, b: GpsSample | undefined): number | undefined {
  if (!a || !b || a === b) return undefined;
  const dt = (b.t - a.t) / 1000;
  if (dt <= 0 || dt >= 10) return undefined;
  const speed = haversineDistance(a.lat, a.lon, b.lat, b.lon) / dt;
  return speed <= MAX_SPEED_MPS ? speed : undefined;
}

function mergeStats(
  existing: ParserStats | undefined,
  inputRows: number,
  keptRows: number,
  counts: { lowQuality: number; teleportation: number; repairedSpeeds: number },
): ParserStats {
  const stats: ParserStats = existing
    ? {
        ...existing,
        acceptedRows: existing.acceptedRows - (inputRows - keptRows),
        rejected: { ...existing.rejected },
      }
    : {
        totalRows: inputRows,
        acceptedRows: keptRows,
        rejected: createRejectedCounter(),
      };
  stats.rejected.lowQuality = (stats.rejected.lowQuality ?? 0) + counts.lowQuality;
  stats.rejected.teleportation += counts.teleportation;
  if (counts.repairedSpeeds > 0) {
    stats.repairedSpeeds = (stats.repairedSpeeds ?? 0) + counts.repairedSpeeds;
  }
  return stats;
}
