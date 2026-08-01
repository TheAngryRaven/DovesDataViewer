/**
 * Post-parse GPS cleanup — runs once for every format, right after
 * `normalizeChannels()` in the datalog router. Walks the parsed samples and
 * rebuilds them into a clean dataset, skipping any row that is provably
 * trash. A row is trash when:
 *
 *   - a quality channel it carries is negative (satellite counts, position
 *     accuracy, and DOP can never go negative — the logger wrote garbage on
 *     that row), or
 *   - its HDOP/pDOP is above `MAX_DOP` (10) — a junk fix, or
 *   - its position implies moving faster than `MAX_SPEED_MPS` (150 m/s,
 *     ~335 mph — the app-wide "anything above is a GPS glitch" bound) from
 *     the last kept row. This catches corrupt fixes that carry NO quality
 *     data at all: with heavy packet loss the logger can write a garbage
 *     position without recording satellites/DOP for it, so the position
 *     itself is the only proof.
 *
 * Quality signals are opt-in per sample and never fabricated — a row is only
 * judged on values the logger actually recorded for it. Because the drop
 * happens before anything downstream runs, the bad rows are voided from every
 * feature (race line, laps, distance, speed stats, charts, g-force, braking
 * zones) at the single point they all draw from.
 *
 * Deliberately nothing else happens here — no smoothing, no interpolation, no
 * repair. Bad rows are skipped, good rows pass through byte-identical.
 * Whether the survivors need further processing is a separate, later step
 * (plan 0014).
 */

import { ParsedData, GpsSample, ParserStats } from '@/types/racing';
import {
  MAX_SPEED_MPS,
  calculateBounds,
  createRejectedCounter,
  haversineDistance,
  isLowQualityFix,
  type GpsQualityReading,
} from './parserUtils';

// Quality-channel keys as they exist AFTER normalizeChannels(): canonical ids
// where the registry knows the name, `custom:` slugs where it doesn't. Each
// list is the "secondary list" for one signal type — extend it when a format
// carries the signal under a new name (e.g. MyChron's GPS_Position_Accuracy).
// pDOP variants stay custom on purpose — pDOP is not HDOP and must not be
// mislabeled in the registry, but the same bound works for either.
const SATELLITE_KEYS = ['satellites'];
const DOP_KEYS = ['hdop', 'custom:gps_pdop', 'custom:gps_posdop', 'custom:gps_hdop', 'custom:pdop'];
const POS_ACCURACY_KEYS = [
  'h_acc',
  'custom:gps_posaccuracy',
  'custom:gps_pos_accuracy',
  'custom:gps_position_accuracy',
];

// After this many consecutive position-jump rejections, re-anchor at the
// current row: if the FIRST kept row was itself garbage, everything real
// would look like a jump from it — the streak reset stops one bad anchor
// from condemning the rest of the file.
const JUMP_REANCHOR_AFTER = 50;

function firstPresentKey(fieldKeys: Set<string>, candidates: string[]): string | undefined {
  return candidates.find((k) => fieldKeys.has(k));
}

/**
 * Rebuild a freshly-parsed (and channel-normalized) session without its
 * bad rows. Returns `data` unchanged when nothing was dropped; otherwise a
 * copy with the clean samples, recomputed bounds/duration, and the drops
 * counted in `parserStats.rejected` (`lowQuality` for condemned quality
 * values, `teleportation` for impossible position jumps).
 */
export function filterGpsQuality(data: ParsedData): ParsedData {
  const { samples } = data;
  if (samples.length === 0) return data;

  const fieldKeys = new Set(data.fieldMappings.map((m) => m.name));
  const satKey = firstPresentKey(fieldKeys, SATELLITE_KEYS);
  const dopKey = firstPresentKey(fieldKeys, DOP_KEYS);
  const accKey = firstPresentKey(fieldKeys, POS_ACCURACY_KEYS);
  const hasQualitySignals = satKey !== undefined || dopKey !== undefined || accKey !== undefined;

  const kept: GpsSample[] = [];
  let lowQuality = 0;
  let teleportation = 0;
  let anchor: GpsSample | null = null;
  let jumpStreak = 0;

  for (const s of samples) {
    if (hasQualitySignals) {
      const reading: GpsQualityReading = {};
      if (satKey !== undefined) reading.satellites = s.extraFields[satKey];
      if (dopKey !== undefined) reading.dop = s.extraFields[dopKey];
      if (accKey !== undefined) reading.posAccuracy = s.extraFields[accKey];
      if (isLowQualityFix(reading)) {
        lowQuality++;
        continue;
      }
    }
    if (anchor) {
      const dt = (s.t - anchor.t) / 1000;
      if (dt > 0 && haversineDistance(anchor.lat, anchor.lon, s.lat, s.lon) / dt > MAX_SPEED_MPS) {
        teleportation++;
        jumpStreak++;
        if (jumpStreak >= JUMP_REANCHOR_AFTER) {
          anchor = s;
          jumpStreak = 0;
        }
        continue;
      }
    }
    anchor = s;
    jumpStreak = 0;
    kept.push(s);
  }

  const dropped = lowQuality + teleportation;
  if (dropped === 0) return data;
  // A file where every single row is condemned is better shown raw than
  // refused — leave it to the user to judge.
  if (kept.length === 0) return data;

  const parserStats = mergeStats(data.parserStats, samples.length, kept.length, lowQuality, teleportation);

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

function mergeStats(
  existing: ParserStats | undefined,
  inputRows: number,
  keptRows: number,
  lowQuality: number,
  teleportation: number,
): ParserStats {
  const dropped = inputRows - keptRows;
  if (existing) {
    return {
      ...existing,
      acceptedRows: existing.acceptedRows - dropped,
      rejected: {
        ...existing.rejected,
        lowQuality: (existing.rejected.lowQuality ?? 0) + lowQuality,
        teleportation: existing.rejected.teleportation + teleportation,
      },
    };
  }
  const rejected = createRejectedCounter();
  rejected.lowQuality = lowQuality;
  rejected.teleportation = teleportation;
  return { totalRows: inputRows, acceptedRows: keptRows, rejected };
}
