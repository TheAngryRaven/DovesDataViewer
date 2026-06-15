/**
 * `.dovep` writer — "Dove phone" log serializer.
 *
 * The phone-as-datalogger produces the same kind of session log the physical
 * DovesDataLogger writes as `.dovex`, and deliberately follows the **same
 * standard** so it can be opened and processed by the app with no special
 * casing: a metadata preamble (datetime/driver/course/short_name/best/optimal +
 * lap times) followed by the standard Dove CSV. The app's existing `.dovex`
 * parser (`dovexParser.ts`) reads this byte-for-byte — `.dovep` is `.dovex`
 * content under a phone-specific extension.
 *
 * The one principled difference: we **do not fabricate** channels the phone
 * can't measure. The device logs `sats,hdop,rpm,accel_*`; the browser exposes
 * none of those, so those columns are simply omitted (the Dove parser treats
 * everything past `timestamp,lat,lng,speed_mph` as optional). We keep the real
 * phone channels: altitude, heading/course, and horizontal accuracy.
 */
import { MPS_TO_MPH } from '@/lib/parserUtils';
import type { GpsObservation } from './customGps';

export const DOVEP_EXTENSION = 'dovep';

/** CSV column order — a strict subset of the Dove/`.dovex` schema (no faked channels). */
const CSV_HEADER = 'timestamp,lat,lng,speed_mph,altitude_m,heading_deg,h_acc_m';

/** Session metadata written into the `.dovep` preamble (mirrors `DovexMetadata`). */
export interface DovepSessionMeta {
  /** "YYYY-MM-DD HH:MM:SS". Derived from the first fix when omitted. */
  datetime?: string;
  driver?: string;
  /** Detected course name. */
  course?: string;
  /** Detected track short name. */
  shortName?: string;
  bestLapMs?: number;
  optimalMs?: number;
  lapTimesMs?: number[];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Format epoch ms as the Dove preamble datetime "YYYY-MM-DD HH:MM:SS" (local time). */
export function formatDovepDatetime(epochMs: number): string {
  const d = new Date(epochMs);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

/** Build the device-style filename `YYYYMMDD_HHMM.dovep` from the session start. */
export function buildDovepFileName(startEpochMs: number): string {
  const d = new Date(startEpochMs);
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}.${DOVEP_EXTENSION}`
  );
}

/** A finite number formatted to `digits`, or '' (blank CSV field) for null/NaN. */
function num(value: number | null | undefined, digits: number): string {
  return value != null && Number.isFinite(value) ? value.toFixed(digits) : '';
}

function csvRow(obs: GpsObservation): string {
  const mph = obs.motion.speedMps != null ? obs.motion.speedMps * MPS_TO_MPH : 0;
  return [
    String(obs.fix.timestamp),
    obs.fix.lat.toFixed(8),
    obs.fix.lon.toFixed(8),
    mph.toFixed(2),
    num(obs.fix.altitude, 2),
    num(obs.motion.course, 2),
    num(obs.fix.accuracy, 2),
  ].join(',');
}

/**
 * Serialize captured observations + session metadata into a `.dovep` document.
 * The preamble's first four lines are the metadata/lap rows the `.dovex` parser
 * expects; the Dove CSV follows. Datetime defaults to the first fix.
 */
export function serializeDovep(observations: GpsObservation[], meta: DovepSessionMeta = {}): string {
  const firstTs = observations.length > 0 ? observations[0].fix.timestamp : Date.now();
  const datetime = meta.datetime ?? formatDovepDatetime(firstTs);

  const metaValues = [
    datetime,
    meta.driver ?? '',
    meta.course ?? '',
    meta.shortName ?? '',
    meta.bestLapMs != null ? String(Math.round(meta.bestLapMs)) : '0',
    meta.optimalMs != null ? String(Math.round(meta.optimalMs)) : '0',
  ].join(',');

  const lapTimes = (meta.lapTimesMs ?? []).map((ms) => String(Math.round(ms))).join(',');

  const preamble = [
    'datetime,driver,course,short_name,best_lap_ms,optimal_ms',
    metaValues,
    'laps_ms',
    lapTimes,
  ].join('\n');

  const csv = [CSV_HEADER, ...observations.map(csvRow)].join('\n');

  // Blank line separates the preamble from the CSV; the parser scans for the
  // `timestamp` header line so exact spacing is not load-bearing.
  return `${preamble}\n\n${csv}\n`;
}

/** Serialize to a Blob ready for IndexedDB storage / download. */
export function serializeDovepBlob(observations: GpsObservation[], meta?: DovepSessionMeta): Blob {
  return new Blob([serializeDovep(observations, meta)], { type: 'text/csv' });
}
