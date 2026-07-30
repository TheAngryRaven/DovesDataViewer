/**
 * Post-parse GPS cleanup — runs once for every format, right after
 * `normalizeChannels()` in the datalog router. Walks the parsed samples and
 * rebuilds them into a clean dataset, dropping any row whose own quality
 * channels condemn it:
 *
 *   - a negative satellite count, position accuracy, or DOP — these can never
 *     go negative, so the logger provably wrote garbage on that row, and
 *   - HDOP/pDOP above `MAX_DOP` (10) — a junk fix.
 *
 * Signals are opt-in per sample: files without quality channels pass through
 * untouched. Because the drop happens before anything downstream runs, the bad
 * rows are voided from every feature (race line, laps, distance, speed stats,
 * charts, g-force, braking zones) at the single point they all draw from.
 *
 * Deliberately nothing else happens here — no smoothing, no interpolation, no
 * speed rules. Clean the dataset first; whether the survivors need further
 * processing is a separate, later step (plan 0014).
 */

import { ParsedData, GpsSample, ParserStats } from '@/types/racing';
import {
  calculateBounds,
  createRejectedCounter,
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

function firstPresentKey(fieldKeys: Set<string>, candidates: string[]): string | undefined {
  return candidates.find((k) => fieldKeys.has(k));
}

/**
 * Rebuild a freshly-parsed (and channel-normalized) session without its
 * bad rows. Returns `data` unchanged when nothing was dropped; otherwise a
 * copy with the clean samples, recomputed bounds/duration, and the drops
 * counted in `parserStats.rejected.lowQuality`.
 */
export function filterGpsQuality(data: ParsedData): ParsedData {
  const { samples } = data;
  if (samples.length === 0) return data;

  const fieldKeys = new Set(data.fieldMappings.map((m) => m.name));
  const satKey = firstPresentKey(fieldKeys, SATELLITE_KEYS);
  const dopKey = firstPresentKey(fieldKeys, DOP_KEYS);
  const accKey = firstPresentKey(fieldKeys, POS_ACCURACY_KEYS);
  if (satKey === undefined && dopKey === undefined && accKey === undefined) return data;

  const kept: GpsSample[] = [];
  for (const s of samples) {
    const reading: GpsQualityReading = {};
    if (satKey !== undefined) reading.satellites = s.extraFields[satKey];
    if (dopKey !== undefined) reading.dop = s.extraFields[dopKey];
    if (accKey !== undefined) reading.posAccuracy = s.extraFields[accKey];
    if (!isLowQualityFix(reading)) kept.push(s);
  }

  const dropped = samples.length - kept.length;
  if (dropped === 0) return data;
  // A file where every single row is condemned is better shown raw than
  // refused — leave it to the user to judge.
  if (kept.length === 0) return data;

  const parserStats = mergeStats(data.parserStats, samples.length, kept.length);

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
): ParserStats {
  const dropped = inputRows - keptRows;
  if (existing) {
    return {
      ...existing,
      acceptedRows: existing.acceptedRows - dropped,
      rejected: { ...existing.rejected, lowQuality: (existing.rejected.lowQuality ?? 0) + dropped },
    };
  }
  const rejected = createRejectedCounter();
  rejected.lowQuality = dropped;
  return { totalRows: inputRows, acceptedRows: keptRows, rejected };
}
