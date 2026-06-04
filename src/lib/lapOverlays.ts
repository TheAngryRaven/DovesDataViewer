/**
 * Pure logic for the multi-lap racing-line overlay (phase 1): turning a set of
 * selected lap/snapshot identities into drawable, colored polylines for the map.
 *
 * Sources are referenced by a stable string id so selection state is trivially
 * serializable and order-stable:
 *   - `lap:<n>`                  — lap number `n` in the current session
 *   - `snap:<id>`                — a saved lap snapshot by its snapshot id
 *   - `file:<lap>\x1f<fileName>` — a lap from another saved file (loaded async;
 *                                  its samples come from the external cache)
 *
 * Same-session `lap:` overlays draw at raw absolute GPS (shared receiver, no
 * relative drift). Cross-session `snap:`/`file:` overlays can be drift-aligned
 * onto the current lap by the caller — see lib/lapAlignment.ts.
 */

import type { GpsSample, Lap } from '@/types/racing';
import type { LapSnapshot } from './lapSnapshot';
import { snapshotLapSamples } from './lapSnapshot';
import { formatLapTime } from './lapCalculation';
import { calculateDistanceArray } from './referenceUtils';

export interface OverlayLine {
  /** Stable identity — `lap:<n>` or `snap:<id>`. */
  id: string;
  /** Human label for the legend / lap list. */
  label: string;
  /** Assigned line color (HSL). */
  color: string;
  /** The lap's clean GPS samples. */
  samples: GpsSample[];
}

export interface MapBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/**
 * Overlay line palette — distinct cool/saturated hues chosen to read clearly
 * against the warm speed heatmap (green→red) and the grey reference line.
 */
export const OVERLAY_COLORS = [
  'hsl(265, 80%, 64%)', // violet
  'hsl(200, 90%, 55%)', // azure
  'hsl(320, 75%, 60%)', // magenta
  'hsl(170, 70%, 45%)', // teal
  'hsl(225, 82%, 64%)', // blue
  'hsl(290, 70%, 62%)', // purple
] as const;

/** Color for the nth overlay line (cycles through the palette). */
export function overlayColor(index: number): string {
  return OVERLAY_COLORS[((index % OVERLAY_COLORS.length) + OVERLAY_COLORS.length) % OVERLAY_COLORS.length];
}

/** Build a stable overlay id from a source kind + key. */
export function overlayId(kind: 'lap' | 'snap', key: string | number): string {
  return `${kind}:${key}`;
}

// ASCII unit separator — never appears in a file name or lap number.
const FILE_ID_SEP = '\x1f';

/** Stable overlay id for a lap from another saved file. */
export function externalOverlayId(fileName: string, lapNumber: number): string {
  return `file:${lapNumber}${FILE_ID_SEP}${fileName}`;
}

/** A loaded external lap's drawable payload, keyed by its `externalOverlayId`. */
export interface ExternalOverlay {
  samples: GpsSample[];
  label: string;
}

/**
 * Resolve selected overlay ids into drawable lines, in selection order. Ids that
 * can't be resolved (a lap no longer present, a snapshot for another course) are
 * skipped; colors are assigned by the *output* index so visible lines always get
 * sequential palette entries.
 */
export function resolveOverlayLines(
  selections: string[],
  opts: {
    laps: Lap[];
    sessionSamples: GpsSample[];
    snapshots: LapSnapshot[];
    externalOverlays?: Record<string, ExternalOverlay>;
  },
): OverlayLine[] {
  const { laps, sessionSamples, snapshots, externalOverlays } = opts;
  const lines: OverlayLine[] = [];

  for (const id of selections) {
    const sep = id.indexOf(':');
    if (sep < 0) continue;
    const kind = id.slice(0, sep);
    const key = id.slice(sep + 1);

    if (kind === 'lap') {
      const lapNumber = Number(key);
      const lap = laps.find((l) => l.lapNumber === lapNumber);
      if (!lap || sessionSamples.length === 0) continue;
      const samples = sessionSamples.slice(lap.startIndex, lap.endIndex + 1);
      if (samples.length < 2) continue;
      lines.push({ id, label: `Lap ${lapNumber}`, color: overlayColor(lines.length), samples });
    } else if (kind === 'snap') {
      const snap = snapshots.find((s) => s.id === key);
      if (!snap) continue;
      const samples = snapshotLapSamples(snap);
      if (samples.length < 2) continue;
      const engine = snap.engine || 'Snapshot';
      lines.push({
        id,
        label: `${engine} · ${formatLapTime(snap.lapTimeMs)}`,
        color: overlayColor(lines.length),
        samples,
      });
    } else if (kind === 'file') {
      const ext = externalOverlays?.[id];
      if (!ext || ext.samples.length < 2) continue;
      lines.push({ id, label: ext.label, color: overlayColor(lines.length), samples: ext.samples });
    }
  }

  return lines;
}

/**
 * Expand `base` bounds to enclose every overlay line's samples, so the map can
 * fit overlays that run slightly outside the active lap (e.g. a cross-session
 * snapshot). Returns `base` unchanged when there are no overlays.
 */
export function unionBounds(base: MapBounds, lines: OverlayLine[]): MapBounds {
  let { minLat, maxLat, minLon, maxLon } = base;
  for (const line of lines) {
    for (const s of line.samples) {
      if (s.lat < minLat) minLat = s.lat;
      if (s.lat > maxLat) maxLat = s.lat;
      if (s.lon < minLon) minLon = s.lon;
      if (s.lon > maxLon) maxLon = s.lon;
    }
  }
  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Crop each overlay line to the same on-track window as the current lap's
 * visible playback range, so cropping the range shrinks the overlay racing
 * lines on the map exactly like the active heatmap line (the charts already do
 * this via {@link alignByDistance}).
 *
 * The window is the cumulative-distance span between `rangeStart` and
 * `rangeEnd` (inclusive indices into `currentFull`, the full current lap); each
 * overlay is sliced to the samples falling in that distance span. Both laps
 * start at the start-finish line, so distance-from-start corresponds to track
 * position — the same correspondence the charts use. Returns the lines
 * unchanged when the range already spans the whole lap (the common case).
 */
export function cropOverlayLinesToWindow(
  lines: OverlayLine[],
  currentFull: GpsSample[],
  rangeStart: number,
  rangeEnd: number,
): OverlayLine[] {
  if (lines.length === 0 || currentFull.length === 0) return lines;
  const lastIdx = currentFull.length - 1;
  const start = Math.max(0, Math.min(rangeStart, lastIdx));
  const end = Math.max(start, Math.min(rangeEnd, lastIdx));
  // Whole lap visible — nothing to crop.
  if (start <= 0 && end >= lastIdx) return lines;

  const cum = calculateDistanceArray(currentFull);
  const dStart = cum[start];
  const dEnd = cum[end];

  return lines.map((line) => {
    if (line.samples.length < 2) return line;
    const ov = calculateDistanceArray(line.samples);
    // First sample at/after the window start; keep the one before (when any) so
    // the cropped line reaches the window's leading edge rather than starting a
    // sample short.
    let lo = ov.findIndex((d) => d >= dStart);
    if (lo === -1) lo = ov.length - 1;
    if (lo > 0) lo -= 1;
    // Last sample at/before the window end; extend one past it (when any) so the
    // line reaches the trailing edge.
    let hi = lo;
    while (hi < ov.length - 1 && ov[hi + 1] <= dEnd) hi++;
    if (hi < ov.length - 1) hi++;
    return { ...line, samples: line.samples.slice(lo, hi + 1) };
  });
}
