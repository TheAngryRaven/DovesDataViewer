/**
 * Pure logic for the multi-lap racing-line overlay (phase 1): turning a set of
 * selected lap/snapshot identities into drawable, colored polylines for the map.
 *
 * Sources are referenced by a stable string id so selection state is trivially
 * serializable and order-stable:
 *   - `lap:<n>`   — lap number `n` in the current session
 *   - `snap:<id>` — a saved lap snapshot by its snapshot id
 *
 * Phase 1 draws raw absolute GPS (same-session laps share a receiver and need no
 * correction). Cross-session drift alignment is a deliberate phase-2 follow-up —
 * see docs/plans/multi-lap-overlay.md.
 */

import type { GpsSample, Lap } from '@/types/racing';
import type { LapSnapshot } from './lapSnapshot';
import { snapshotLapSamples } from './lapSnapshot';
import { formatLapTime } from './lapCalculation';

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

/**
 * Resolve selected overlay ids into drawable lines, in selection order. Ids that
 * can't be resolved (a lap no longer present, a snapshot for another course) are
 * skipped; colors are assigned by the *output* index so visible lines always get
 * sequential palette entries.
 */
export function resolveOverlayLines(
  selections: string[],
  opts: { laps: Lap[]; sessionSamples: GpsSample[]; snapshots: LapSnapshot[] },
): OverlayLine[] {
  const { laps, sessionSamples, snapshots } = opts;
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
