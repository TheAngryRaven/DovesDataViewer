/**
 * Pure GoPro telemetry model (plan 0029): turns decoded `gpmd` payloads and
 * their MP4 timing into GPS rows, then serialises those rows as a Dove CSV —
 * the app's own simple format — so a GoPro import is stored, reopened, synced
 * and shared exactly like any other `.dove` session.
 *
 * Time model: the MP4 container is the clock. A payload's presentation time
 * (`stts`) plus an even spread of its samples across the payload's duration
 * gives each fix a media time; the GPS UTC (GPSU / GPS9) only anchors that
 * timeline to an absolute date. Because the video shares the same timeline, the
 * offset that syncs footage to telemetry is known outright: session time 0 is
 * the first accepted fix, so video time 0 ↔ session ms `-(firstFixMediaSec ×
 * 1000)`.
 */
import { MPS_TO_MPH, validateGpsCoords } from "@/lib/parserUtils";
import { extractGpsPayload } from "./gpmf";

export interface GoProPayload {
  data: ArrayBuffer;
  /** Presentation time of the payload on the movie timeline (seconds). */
  timeSec: number;
  durationSec: number;
}

/** One accepted GPS fix positioned on the (possibly multi-chapter) timeline. */
export interface GoProGpsRow {
  /** Seconds on the stitched video timeline. */
  tSec: number;
  lat: number;
  lon: number;
  altitudeM: number;
  speedMps: number;
  dop: number;
  /** Absolute UTC (epoch ms) when the fix carried or inherited one. */
  utcMs?: number;
}

/** GPS fix quality below which a sample is dropped (0 = no lock; 2D/3D keep). */
const MIN_FIX = 2;

/**
 * Decode one chapter's payloads into rows, offset by `chapterOffsetSec` (the
 * cumulative duration of the chapters before it). Unlocked fixes and invalid
 * coordinates are dropped here; DOP gating is left to the shared
 * `gpsQualityFilter` so every format is judged by the same rule.
 */
export function rowsFromPayloads(payloads: GoProPayload[], chapterOffsetSec = 0): GoProGpsRow[] {
  const rows: GoProGpsRow[] = [];
  for (const payload of payloads) {
    const gps = extractGpsPayload(payload.data);
    if (!gps || gps.fixes.length === 0) continue;
    const step = payload.durationSec / gps.fixes.length;
    gps.fixes.forEach((fix, i) => {
      if (fix.fix < MIN_FIX) return;
      if (validateGpsCoords(fix.lat, fix.lon) !== null) return;
      if (!Number.isFinite(fix.speedMps) || fix.speedMps < 0) return;
      const withinSec = i * step;
      const utcMs = fix.utcMs ?? (gps.utcMs !== undefined ? gps.utcMs + withinSec * 1000 : undefined);
      rows.push({
        tSec: chapterOffsetSec + payload.timeSec + withinSec,
        lat: fix.lat,
        lon: fix.lon,
        altitudeM: fix.altitudeM,
        speedMps: fix.speedMps,
        dop: fix.dop,
        utcMs,
      });
    });
  }
  return rows;
}

export interface GoProSession {
  /** Dove CSV text ready to be saved as the session file. */
  csv: string;
  /** Epoch ms of session time 0 (the first row). */
  startEpochMs: number;
  /** Video-sync offset for `useVideoSync`: session ms that lines up with video time 0. */
  syncOffsetMs: number;
  rowCount: number;
}

/** Dove CSV columns written. `sats` is omitted — GPMF carries no satellite count. */
const CSV_HEADER = "timestamp,lat,lng,speed_mph,altitude_m,hdop";

/**
 * Serialise rows to a Dove CSV. `fallbackEpochMs` (the MP4 creation time)
 * anchors the timeline when no fix carried a UTC stamp at all.
 */
export function buildGoProSession(rows: GoProGpsRow[], fallbackEpochMs?: number): GoProSession {
  if (rows.length === 0) throw new Error("No GPS fixes with a satellite lock were found in this GoPro video");

  // Anchor absolute time on the first fix that knows its UTC; every row then
  // follows the container clock from there (GPS UTC jitters, the MP4 doesn't).
  const anchor = rows.find((r) => r.utcMs !== undefined);
  const epochAtZero = anchor
    ? anchor.utcMs! - anchor.tSec * 1000
    : fallbackEpochMs !== undefined
      ? fallbackEpochMs - rows[0].tSec * 1000
      : undefined;
  if (epochAtZero === undefined) throw new Error("GoPro video carries no GPS time — cannot date the session");

  const lines = [CSV_HEADER];
  let lastTimestamp = -Infinity;
  for (const r of rows) {
    // Dove rows must strictly advance; clamp any rounding collision forward 1 ms.
    let timestamp = Math.round(epochAtZero + r.tSec * 1000);
    if (timestamp <= lastTimestamp) timestamp = lastTimestamp + 1;
    lastTimestamp = timestamp;
    lines.push([
      String(timestamp),
      r.lat.toFixed(7),
      r.lon.toFixed(7),
      (r.speedMps * MPS_TO_MPH).toFixed(2),
      r.altitudeM.toFixed(2),
      r.dop.toFixed(2),
    ].join(","));
  }

  return {
    csv: `${lines.join("\n")}\n`,
    startEpochMs: Math.round(epochAtZero + rows[0].tSec * 1000),
    // `0 - x` rather than `-x` so a first fix at t=0 yields +0, not -0.
    syncOffsetMs: 0 - Math.round(rows[0].tSec * 1000),
    rowCount: rows.length,
  };
}
