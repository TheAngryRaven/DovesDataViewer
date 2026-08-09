/**
 * Which courses the user has explicitly chosen to keep on, or off, a logger
 * (plan 0017).
 *
 * Only DEVIATIONS from the default rule live here — see
 * `overridesFromSelection`. A track the user never curated stores nothing and
 * follows the rule forever.
 *
 * Deliberately **not** a cloud-synced doc store. This describes one physical SD
 * card: which subset of a track's courses is currently written to it. Syncing it
 * would push one card's contents onto every logger the user owns, and the
 * penalty for getting that wrong is a track file over the device's parse buffer
 * — which is not a degraded track, it is a track that stops being detected at
 * the venue. The courses themselves are already cloud-synced with the garage, so
 * nothing is lost by keeping this local; the user re-picks on a new browser, and
 * until they do, the default rule produces a set the device can hold.
 *
 * Keyed by logger, because the owner runs more than one and they hold different
 * cards.
 */

import type { TrackKind } from '@/lib/ble/trackOpcodes';
import type { TrackCourseOverrides } from '@/lib/deviceCourseSelection';
import { NO_OVERRIDES } from '@/lib/deviceCourseSelection';

const KEY = 'dove-device-course-overrides';

/** Enough for a large fleet; keeps a corrupt or runaway store bounded. */
const MAX_LOGGERS = 20;
/** Far more tracks than a card holds; the same bound, one level down. */
const MAX_TRACKS = 200;

/**
 * Deliberately no time-based expiry.
 *
 * An expiring curation silently re-adds courses to a card that was deliberately
 * trimmed, pushing the file back over the buffer — and the user finds out at the
 * venue, when the track no longer registers. A stale entry costs a few bytes of
 * localStorage; a lapsed one costs a track day. Growth is bounded by count
 * instead, evicting the least recently written.
 */
export interface LoggerCourseOverrides {
  /** Last write, for eviction order only. */
  ts: number;
  /** Keyed by `trackOverrideKey`. */
  tracks: Record<string, TrackCourseOverrides>;
}

export type CourseOverrideStore = Record<string, LoggerCourseOverrides>;

/**
 * The store key for one logger.
 *
 * An unnamed logger still gets a key rather than being skipped: on the web the
 * BLE name is all we have, and no name at all is better treated as one anonymous
 * logger than as "never remember anything".
 */
export function loggerOverrideKey(deviceName: string | null | undefined): string {
  return deviceName || 'unknown';
}

/**
 * The key for one track within a logger.
 *
 * `(kind, shortName)` — the same pair the device sync merge keys on, because a
 * circuit and a sprint track are separate files in separate folders and may
 * legitimately share a short name.
 */
export function trackOverrideKey(kind: TrackKind, shortName: string): string {
  return `${kind}:${shortName}`;
}

function isOverrides(v: unknown): v is TrackCourseOverrides {
  if (!v || typeof v !== 'object') return false;
  const o = v as Partial<TrackCourseOverrides>;
  return (
    Array.isArray(o.include) &&
    Array.isArray(o.exclude) &&
    o.include.every((n) => typeof n === 'string') &&
    o.exclude.every((n) => typeof n === 'string')
  );
}

/**
 * Parse the stored blob, dropping anything malformed. Pure, so the validation
 * rules are testable without touching storage.
 *
 * Anything unrecognised decays to "no overrides", which means the default rule
 * applies — a working configuration, not a broken one.
 */
export function parseCourseOverrides(raw: string | null): CourseOverrideStore {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const out: CourseOverrideStore = {};
    const loggers = Object.entries(parsed as Record<string, unknown>)
      .filter((e): e is [string, LoggerCourseOverrides] => {
        const v = e[1];
        if (!v || typeof v !== 'object') return false;
        const l = v as Partial<LoggerCourseOverrides>;
        return typeof l.ts === 'number' && Number.isFinite(l.ts) && !!l.tracks &&
          typeof l.tracks === 'object';
      })
      .sort((a, b) => b[1].ts - a[1].ts)
      .slice(0, MAX_LOGGERS);

    for (const [id, logger] of loggers) {
      const tracks: Record<string, TrackCourseOverrides> = {};
      for (const [key, value] of Object.entries(logger.tracks).slice(0, MAX_TRACKS)) {
        if (isOverrides(value)) tracks[key] = { include: value.include, exclude: value.exclude };
      }
      out[id] = { ts: logger.ts, tracks };
    }
    return out;
  } catch {
    return {};
  }
}

function readStore(): CourseOverrideStore {
  try {
    return parseCourseOverrides(localStorage.getItem(KEY));
  } catch {
    return {};
  }
}

function writeStore(store: CourseOverrideStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable — curation falls back to the default rule */
  }
}

/** True when nothing is actually overridden — the default rule alone applies. */
export function isEmptyOverrides(o: TrackCourseOverrides): boolean {
  return o.include.length === 0 && o.exclude.length === 0;
}

/** The user's overrides for one track on one logger, or none. */
export function loadTrackOverrides(
  deviceName: string | null | undefined,
  kind: TrackKind,
  shortName: string,
): TrackCourseOverrides {
  const logger = readStore()[loggerOverrideKey(deviceName)];
  return logger?.tracks[trackOverrideKey(kind, shortName)] ?? NO_OVERRIDES;
}

/**
 * Record the user's overrides for one track on one logger.
 *
 * Empty overrides REMOVE the entry rather than storing an empty one, so
 * "put this back the way it was" is representable and the store stays small.
 */
export function saveTrackOverrides(
  deviceName: string | null | undefined,
  kind: TrackKind,
  shortName: string,
  overrides: TrackCourseOverrides,
): void {
  const store = readStore();
  const id = loggerOverrideKey(deviceName);
  const trackKey = trackOverrideKey(kind, shortName);
  const tracks = { ...(store[id]?.tracks ?? {}) };

  if (isEmptyOverrides(overrides)) delete tracks[trackKey];
  else tracks[trackKey] = { include: [...overrides.include], exclude: [...overrides.exclude] };

  if (Object.keys(tracks).length === 0) delete store[id];
  else store[id] = { ts: Date.now(), tracks };

  writeStore(store);
}

/** Drop every stored override. Exposed for tests and a "reset" action. */
export function clearCourseOverrides(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
