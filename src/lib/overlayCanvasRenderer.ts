/**
 * The single overlay scene renderer (plan 0023).
 *
 * Every surface that draws overlays goes through the per-type draw functions
 * in this file: the live preview in VideoPlayer (via OverlayCanvas), the
 * WebCodecs export pipeline, and — next — the native shell's burn-in export.
 * One draw path is what keeps the VFX from drifting between preview and
 * output; before this file was unified, the preview components and the
 * export renderer each carried their own copy of the drawing math and had
 * already diverged (grid lines, glow, labels, i18n).
 *
 * Contracts:
 * - Draw functions take an OverlayLayout whose x/y is the overlay's top-left
 *   in canvas pixels. The preview host draws a single overlay at (0,0); the
 *   export loop positions each overlay from its stored percentage position.
 * - measureOverlay() and the draws share the same box math — measure is what
 *   the preview host sizes its canvas by, so a draw must never paint outside
 *   the measured box (the bubble's below-circle label, clipped identically
 *   in the old preview, is grandfathered).
 * - User-facing strings come in through OverlayLabels so the React side can
 *   pass translations; DEFAULT_OVERLAY_LABELS keeps callers without an i18n
 *   context (tests, workers) in English.
 * - Everything time-based (including the sector completion sweep) is driven
 *   by DATA time, never wall-clock, so an exported frame at time t is
 *   identical to the preview paused at time t.
 */

import type { OverlayInstance, OverlayRenderContext } from "@/components/video-overlays/types";
import { getTheme } from "@/components/video-overlays/themes";
import { resolveValue, resolveRange, resolveUnit } from "@/components/video-overlays/dataSourceResolver";
import {
  computeSectorSegments,
  computeSectorDisplayStates,
  SECTOR_COLORS,
  type SectorStatus,
} from "@/components/video-overlays/sectorUtils";
import { courseHasSectors } from "@/types/racing";
import { findCurrentLap, formatOverlayLapTime, getOverlayLapStartTime } from "@/components/video-overlays/overlayUtils";
import type { GpsSample } from "@/types/racing";

const START_ANGLE = Math.PI * 0.8;
const END_ANGLE = Math.PI * 2.2;
const SWEEP = END_ANGLE - START_ANGLE;

/** How long the sector completion sweep runs, in DATA milliseconds. */
export const SECTOR_SWEEP_MS = 600;

export interface OverlayLayout {
  x: number; // px, top-left
  y: number; // px, top-left
  fontSize: number; // px, the overlay's scaled base font size
}

/** Rolling per-instance value history for graph overlays, keyed by instance id. */
export type GraphHistories = Map<string, number[]>;

/**
 * User-facing strings drawn into overlays. React callers build this from
 * their translations (the "video" namespace's widgets.* keys); everything
 * else falls back to the English defaults.
 */
export interface OverlayLabels {
  slow: string;
  fast: string;
  lapTime: string;
  delta: string;
  /** `lapLabel` is e.g. "L3", or "" when there is no best lap yet. */
  best: (lapLabel: string) => string;
}

export const DEFAULT_OVERLAY_LABELS: OverlayLabels = {
  slow: "SLOW",
  fast: "FAST",
  lapTime: "LAP TIME",
  delta: "DELTA",
  best: (lapLabel: string) => (lapLabel ? `BEST ${lapLabel}` : "BEST"),
};

/** The sector widget's cell backgrounds (the map line uses SECTOR_COLORS). */
const SECTOR_CELL_BG: Record<SectorStatus, string> = {
  best: "rgba(168, 85, 247, 0.7)",
  slower: "rgba(239, 68, 68, 0.7)",
  first: "rgba(34, 197, 94, 0.7)",
  active: "rgba(59, 130, 246, 0.5)",
  outlap: "rgba(128, 128, 128, 0.25)",
};

// ── Per-session memo caches ─────────────────────────────────────────────────
//
// The draws below used to rescan the session arrays on every frame — the
// export path repeated ~10 full O(samples) passes per output frame for
// answers that never change (ranges, map bounds, the pace scale). The arrays
// are immutable per session/export, so the caches key on array identity via
// WeakMap: a new session (or a rebuilt range array) misses naturally, and
// nothing here needs invalidation or leaks.

interface RangeEntry {
  paceData: (number | null)[];
  brakingGData: number[];
  range: { min: number; max: number };
}
const rangeCaches = new WeakMap<GpsSample[], Map<string, RangeEntry>>();

function memoRange(
  sourceId: string,
  ctx: OverlayRenderContext,
): { min: number; max: number } {
  let bySource = rangeCaches.get(ctx.samples);
  if (!bySource) {
    bySource = new Map();
    rangeCaches.set(ctx.samples, bySource);
  }
  const hit = bySource.get(sourceId);
  // Special sources (__pace__, __braking_g__) range over these arrays, not
  // the samples — a hit is only valid while they are the same arrays too.
  if (hit && hit.paceData === ctx.paceData && hit.brakingGData === ctx.brakingGData) {
    return hit.range;
  }
  const range = resolveRange(sourceId, ctx.samples, ctx.dataSources, ctx.paceData, ctx.brakingGData);
  bySource.set(sourceId, {
    paceData: ctx.paceData,
    brakingGData: ctx.brakingGData,
    range,
  });
  return range;
}

interface MapBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}
const mapBoundsCache = new WeakMap<GpsSample[], MapBounds>();

function memoMapBounds(samples: GpsSample[]): MapBounds {
  const hit = mapBoundsCache.get(samples);
  if (hit) return hit;
  let minLat = Infinity,
    maxLat = -Infinity,
    minLon = Infinity,
    maxLon = -Infinity;
  for (const s of samples) {
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lon < minLon) minLon = s.lon;
    if (s.lon > maxLon) maxLon = s.lon;
  }
  const bounds = { minLat, maxLat, minLon, maxLon };
  mapBoundsCache.set(samples, bounds);
  return bounds;
}

const paceMaxCache = new WeakMap<(number | null)[], number>();

function memoPaceMax(paceData: (number | null)[]): number {
  const hit = paceMaxCache.get(paceData);
  if (hit !== undefined) return hit;
  let maxDelta = 0.5;
  for (const v of paceData) {
    if (v !== null && Math.abs(v) > maxDelta) maxDelta = Math.abs(v);
  }
  maxDelta = Math.min(maxDelta * 1.2, 5);
  paceMaxCache.set(paceData, maxDelta);
  return maxDelta;
}

/** The digital widget's box, shared by measure and draw so the resolved value
 * is only computed once per draw. */
function digitalBox(fontSize: number, displayVal: string, unit: string): { w: number; h: number } {
  return {
    w: displayVal.length * fontSize * 0.65 + unit.length * fontSize * 0.35 + fontSize * 0.6,
    h: fontSize * 1.5,
  };
}

function computeLayout(
  instance: OverlayInstance,
  canvasWidth: number,
  canvasHeight: number,
): OverlayLayout {
  const baseFontPx = (canvasWidth / 640) * 18;
  const scale = instance.position.scale ?? 1;
  const fontSize = baseFontPx * scale;
  const x = (instance.position.x / 100) * canvasWidth;
  const y = (instance.position.y / 100) * canvasHeight;
  return { x, y, fontSize };
}

/**
 * The box an overlay instance draws into, in px, for a given font size.
 * The preview host sizes its canvas from this; the draws use the same math.
 */
export function measureOverlay(
  instance: OverlayInstance,
  ctx: OverlayRenderContext,
  fontSize: number,
): { w: number; h: number } {
  const f = fontSize;
  switch (instance.type) {
    case "digital": {
      const value = resolveValue(instance.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, ctx.brakingGData);
      const unit = resolveUnit(instance.dataSource, ctx.dataSources);
      const displayVal = value !== null ? value.toFixed(1) : "—";
      return digitalBox(f, displayVal, unit);
    }
    case "analog": {
      const size = Math.round(f * 5);
      return { w: size, h: size };
    }
    case "graph":
      return { w: Math.round(f * 10), h: Math.round(f * 4) };
    case "bar":
      return { w: f * 8 + f * 0.6, h: f * 1.6 };
    case "bubble": {
      const size = Math.round(f * 6);
      return { w: size, h: size };
    }
    case "map": {
      const size = Math.round(f * 6);
      return { w: size, h: size };
    }
    case "pace":
      return { w: f * 10 + f * 0.6, h: f * 2.2 };
    case "sector":
      return { w: 3 * (f * 3) + 2 * (f * 0.2), h: f * 1.6 };
    case "laptime":
      return {
        w: f * ((instance.showPaceMode ?? false) ? 8 : 5),
        h: f * ((instance.showPaceMode ?? false) ? 3.2 : 2),
      };
  }
}

/** Draw one overlay instance at its layout position. */
export function drawOverlayInstance(
  c: CanvasRenderingContext2D,
  instance: OverlayInstance,
  ctx: OverlayRenderContext,
  layout: OverlayLayout,
  histories: GraphHistories,
  labels: OverlayLabels = DEFAULT_OVERLAY_LABELS,
): void {
  switch (instance.type) {
    case "digital": drawDigital(c, instance, ctx, layout); break;
    case "analog": drawAnalog(c, instance, ctx, layout); break;
    case "graph": drawGraph(c, instance, ctx, layout, histories); break;
    case "bar": drawBar(c, instance, ctx, layout); break;
    case "bubble": drawBubble(c, instance, ctx, layout); break;
    case "map": drawMap(c, instance, ctx, layout); break;
    case "pace": drawPace(c, instance, ctx, layout, labels); break;
    case "sector": drawSector(c, instance, ctx, layout); break;
    case "laptime": drawLapTime(c, instance, ctx, layout, labels); break;
  }
}

/**
 * Render all visible overlays to a canvas context.
 * Called once per frame during export (and by the native burn-in path).
 */
export function renderOverlaysToCanvas(
  ctx2d: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlays: OverlayInstance[],
  renderCtx: OverlayRenderContext,
  graphHistories: GraphHistories,
  labels: OverlayLabels = DEFAULT_OVERLAY_LABELS,
): void {
  for (const overlay of overlays) {
    if (!overlay.visible) continue;
    const layout = computeLayout(overlay, width, height);

    ctx2d.save();
    // Opacity is already baked into theme.bg() RGBA values — do NOT set globalAlpha
    // here, or backgrounds get double-opacity and text/lines become semi-transparent.
    drawOverlayInstance(ctx2d, overlay, renderCtx, layout, graphHistories, labels);
    ctx2d.restore();
  }
}


export function drawDigital(c: CanvasRenderingContext2D, inst: OverlayInstance, ctx: OverlayRenderContext, l: OverlayLayout) {
  const theme = getTheme(inst.theme);
  const value = resolveValue(inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, ctx.brakingGData);
  const unit = resolveUnit(inst.dataSource, ctx.dataSources);
  const displayVal = value !== null ? value.toFixed(1) : "—";

  const { w: textW, h } = digitalBox(l.fontSize, displayVal, unit);

  // Background
  c.fillStyle = theme.bg(inst.colorMode, inst.opacity);
  roundRect(c, l.x, l.y, textW, h, l.fontSize * 0.2);
  c.fill();
  c.strokeStyle = theme.border(inst.colorMode);
  c.lineWidth = 1;
  c.stroke();

  // Value
  c.fillStyle = theme.text(inst.colorMode);
  c.font = `bold ${l.fontSize}px "JetBrains Mono", monospace`;
  c.textAlign = "left";
  c.textBaseline = "middle";
  c.fillText(displayVal, l.x + l.fontSize * 0.3, l.y + h / 2);

  // Unit
  c.fillStyle = theme.textSecondary(inst.colorMode);
  c.font = `${l.fontSize * 0.55}px "JetBrains Mono", monospace`;
  c.fillText(unit, l.x + l.fontSize * 0.3 + displayVal.length * l.fontSize * 0.65 + l.fontSize * 0.15, l.y + h / 2);
}

export function drawAnalog(c: CanvasRenderingContext2D, inst: OverlayInstance, ctx: OverlayRenderContext, l: OverlayLayout) {
  const theme = getTheme(inst.theme);
  const value = resolveValue(inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, ctx.brakingGData);
  const { min, max } = memoRange(inst.dataSource, ctx);
  const unit = resolveUnit(inst.dataSource, ctx.dataSources);

  const size = measureOverlay(inst, ctx, l.fontSize).w;
  const cx = l.x + size / 2;
  const cy = l.y + size / 2;
  const r = size * 0.4;

  // Background
  c.beginPath();
  c.arc(cx, cy, r + size * 0.08, 0, Math.PI * 2);
  c.fillStyle = theme.bg(inst.colorMode, inst.opacity);
  c.fill();
  c.strokeStyle = theme.border(inst.colorMode);
  c.lineWidth = 1;
  c.stroke();

  // Track arc
  c.beginPath();
  c.arc(cx, cy, r, START_ANGLE, END_ANGLE);
  c.strokeStyle = theme.ringColor(inst.colorMode);
  c.lineWidth = size * 0.04;
  c.lineCap = "round";
  c.stroke();

  // Ticks
  for (let i = 0; i <= 10; i++) {
    const angle = START_ANGLE + (i / 10) * SWEEP;
    const isMajor = i % 5 === 0;
    const innerR = r - (isMajor ? size * 0.1 : size * 0.06);
    c.beginPath();
    c.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
    c.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    c.strokeStyle = theme.textSecondary(inst.colorMode);
    c.lineWidth = isMajor ? 2 : 1;
    c.stroke();
  }

  // Needle (glow themes blur it, like the old preview did)
  if (value !== null) {
    const range = max - min || 1;
    const fraction = Math.max(0, Math.min(1, (value - min) / range));
    const needleAngle = START_ANGLE + fraction * SWEEP;
    const needleLen = r * 0.85;
    c.save();
    if (theme.glowFilter) {
      c.shadowColor = theme.needleColor(inst.colorMode);
      c.shadowBlur = 6;
    }
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(cx + Math.cos(needleAngle) * needleLen, cy + Math.sin(needleAngle) * needleLen);
    c.strokeStyle = theme.needleColor(inst.colorMode);
    c.lineWidth = size * 0.025;
    c.lineCap = "round";
    c.stroke();
    c.restore();
    c.beginPath();
    c.arc(cx, cy, size * 0.03, 0, Math.PI * 2);
    c.fillStyle = theme.needleColor(inst.colorMode);
    c.fill();
  }

  // Value text
  c.fillStyle = theme.text(inst.colorMode);
  c.font = `bold ${size * 0.14}px "JetBrains Mono", monospace`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(value !== null ? value.toFixed(1) : "—", cx, cy + r * 0.35);
  c.fillStyle = theme.textSecondary(inst.colorMode);
  c.font = `${size * 0.08}px "JetBrains Mono", monospace`;
  c.fillText(unit, cx, cy + r * 0.55);
}

export function drawGraph(
  c: CanvasRenderingContext2D,
  inst: OverlayInstance,
  ctx: OverlayRenderContext,
  l: OverlayLayout,
  histories: GraphHistories,
) {
  const theme = getTheme(inst.theme);
  const value = resolveValue(inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, ctx.brakingGData);
  const { min, max } = memoRange(inst.dataSource, ctx);
  const unit = resolveUnit(inst.dataSource, ctx.dataSources);
  const graphLength = inst.graphLength ?? 100;
  const lineColor = inst.color ?? theme.accent(inst.colorMode);

  // Update history
  let history = histories.get(inst.id) ?? [];
  if (value !== null) {
    history.push(value);
    if (history.length > graphLength) history = history.slice(-graphLength);
    histories.set(inst.id, history);
  }

  const { w, h } = measureOverlay(inst, ctx, l.fontSize);
  const pad = 4;

  // Background
  c.fillStyle = theme.bg(inst.colorMode, inst.opacity);
  roundRect(c, l.x, l.y, w, h, l.fontSize * 0.2);
  c.fill();
  c.strokeStyle = theme.border(inst.colorMode);
  c.lineWidth = 1;
  c.stroke();

  if (history.length < 2) return;

  const range = max - min || 1;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2 - l.fontSize * 0.8;
  const plotTop = l.y + pad;

  // Grid lines
  c.strokeStyle = theme.ringColor(inst.colorMode);
  c.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = plotTop + (i / 4) * plotH;
    c.beginPath();
    c.moveTo(l.x + pad, y);
    c.lineTo(l.x + pad + plotW, y);
    c.stroke();
  }

  // Line
  c.beginPath();
  for (let i = 0; i < history.length; i++) {
    const x = l.x + pad + (i / (graphLength - 1)) * plotW;
    const y = plotTop + plotH - ((history[i] - min) / range) * plotH;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.strokeStyle = lineColor;
  c.lineWidth = 2;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.stroke();

  // Value label
  c.fillStyle = theme.text(inst.colorMode);
  c.font = `bold ${l.fontSize * 0.6}px "JetBrains Mono", monospace`;
  c.textAlign = "right";
  c.textBaseline = "bottom";
  c.fillText(`${value !== null ? value.toFixed(1) : "—"} ${unit}`, l.x + w - pad, l.y + h - pad * 0.5);
}

export function drawBar(c: CanvasRenderingContext2D, inst: OverlayInstance, ctx: OverlayRenderContext, l: OverlayLayout) {
  const theme = getTheme(inst.theme);
  const value = resolveValue(inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, ctx.brakingGData);
  const { min, max } = memoRange(inst.dataSource, ctx);
  const unit = resolveUnit(inst.dataSource, ctx.dataSources);
  const range = max - min || 1;
  const fraction = value !== null ? Math.max(0, Math.min(1, (value - min) / range)) : 0;
  const barColor = inst.color ?? theme.accent(inst.colorMode);
  const displayVal = value !== null ? value.toFixed(1) : "—";

  const barW = l.fontSize * 8;
  const { w: totalW, h: totalH } = measureOverlay(inst, ctx, l.fontSize);
  const barH = l.fontSize * 0.6;

  c.fillStyle = theme.bg(inst.colorMode, inst.opacity);
  roundRect(c, l.x, l.y, totalW, totalH, l.fontSize * 0.2);
  c.fill();
  c.strokeStyle = theme.border(inst.colorMode);
  c.lineWidth = 1;
  c.stroke();

  // Value
  c.fillStyle = theme.text(inst.colorMode);
  c.font = `bold ${l.fontSize * 0.7}px "JetBrains Mono", monospace`;
  c.textAlign = "left";
  c.textBaseline = "top";
  c.fillText(displayVal, l.x + l.fontSize * 0.3, l.y + l.fontSize * 0.15);

  // Unit
  c.fillStyle = theme.textSecondary(inst.colorMode);
  c.font = `${l.fontSize * 0.45}px "JetBrains Mono", monospace`;
  c.textAlign = "right";
  c.fillText(unit, l.x + totalW - l.fontSize * 0.3, l.y + l.fontSize * 0.2);

  // Bar track
  const barY = l.y + totalH - barH - l.fontSize * 0.2;
  c.fillStyle = theme.ringColor(inst.colorMode);
  roundRect(c, l.x + l.fontSize * 0.3, barY, barW, barH, barH / 2);
  c.fill();

  // Bar fill
  if (fraction > 0) {
    c.fillStyle = barColor;
    roundRect(c, l.x + l.fontSize * 0.3, barY, barW * fraction, barH, barH / 2);
    c.fill();
  }
}

export function drawBubble(c: CanvasRenderingContext2D, inst: OverlayInstance, ctx: OverlayRenderContext, l: OverlayLayout) {
  const theme = getTheme(inst.theme);
  const valueX = resolveValue(inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, ctx.brakingGData);
  const valueY = resolveValue(inst.dataSourceSecondary ?? inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, ctx.brakingGData);
  const rangeX = memoRange(inst.dataSource, ctx);
  const rangeY = memoRange(inst.dataSourceSecondary ?? inst.dataSource, ctx);

  const size = measureOverlay(inst, ctx, l.fontSize).w;
  const cx = l.x + size / 2;
  const cy = l.y + size / 2;
  const outerR = size * 0.42;

  // Background
  c.beginPath();
  c.arc(cx, cy, outerR + size * 0.04, 0, Math.PI * 2);
  c.fillStyle = theme.bg(inst.colorMode, inst.opacity);
  c.fill();
  c.strokeStyle = theme.border(inst.colorMode);
  c.lineWidth = 1;
  c.stroke();

  // Rings + crosshairs
  c.strokeStyle = theme.ringColor(inst.colorMode);
  c.lineWidth = 1.5;
  c.beginPath(); c.arc(cx, cy, outerR, 0, Math.PI * 2); c.stroke();
  c.lineWidth = 1;
  c.beginPath(); c.arc(cx, cy, outerR * 0.5, 0, Math.PI * 2); c.stroke();
  c.lineWidth = 0.5;
  c.beginPath();
  c.moveTo(cx - outerR, cy); c.lineTo(cx + outerR, cy);
  c.moveTo(cx, cy - outerR); c.lineTo(cx, cy + outerR);
  c.stroke();

  // Center dot
  c.beginPath();
  c.arc(cx, cy, 3, 0, Math.PI * 2);
  c.fillStyle = theme.textSecondary(inst.colorMode);
  c.fill();

  // Data point (glow themes blur it)
  if (valueX !== null && valueY !== null) {
    const xR = Math.max(Math.abs(rangeX.min), Math.abs(rangeX.max)) || 1;
    const yR = Math.max(Math.abs(rangeY.min), Math.abs(rangeY.max)) || 1;
    const px = cx + (valueX / xR) * outerR * 0.9;
    const py = cy - (valueY / yR) * outerR * 0.9; // inverted Y
    c.save();
    if (theme.glowFilter) {
      c.shadowColor = theme.accent(inst.colorMode);
      c.shadowBlur = 8;
    }
    c.beginPath();
    c.arc(px, py, size * 0.04, 0, Math.PI * 2);
    c.fillStyle = theme.accent(inst.colorMode);
    c.fill();
    c.restore();

    c.fillStyle = theme.text(inst.colorMode);
    c.font = `bold ${size * 0.07}px "JetBrains Mono", monospace`;
    c.textAlign = "center";
    c.fillText(`${valueX.toFixed(2)} / ${valueY.toFixed(2)}`, cx, cy + outerR + size * 0.08);
  }
}

export function drawMap(c: CanvasRenderingContext2D, inst: OverlayInstance, ctx: OverlayRenderContext, l: OverlayLayout) {
  const theme = getTheme(inst.theme);
  const size = measureOverlay(inst, ctx, l.fontSize).w;

  const pad = size * 0.08;

  // Background (drawn even with no data, matching the old preview)
  c.fillStyle = theme.bg(inst.colorMode, inst.opacity);
  roundRect(c, l.x, l.y, size, size, l.fontSize * 0.2);
  c.fill();
  c.strokeStyle = theme.border(inst.colorMode);
  c.lineWidth = 1;
  c.stroke();

  // The plain line follows the visible range; framing always comes from the
  // whole session so the map doesn't re-zoom when the range changes.
  const samples = ctx.samples.length > 1 ? ctx.samples : ctx.allSamples;
  if (samples.length < 2) return;
  const allSmp = ctx.allSamples.length > 1 ? ctx.allSamples : samples;

  // Bounds (memoized per session — invariant across frames)
  const { minLat, maxLat, minLon, maxLon } = memoMapBounds(allSmp);
  const latRange = maxLat - minLat || 0.001;
  const lonRange = maxLon - minLon || 0.001;
  const plotSize = size - pad * 2;
  const scale = Math.min(plotSize / lonRange, plotSize / latRange);
  const offsetX = l.x + pad + (plotSize - lonRange * scale) / 2;
  const offsetY = l.y + pad + (plotSize - latRange * scale) / 2;
  const toX = (lon: number) => offsetX + (lon - minLon) * scale;
  const toY = (lat: number) => offsetY + (maxLat - lat) * scale;

  c.lineCap = "round";
  c.lineJoin = "round";

  const showSectors = inst.showSectors === true && courseHasSectors(ctx.course);
  const currentLap = findCurrentLap(ctx.laps, ctx.selectedLapNumber, ctx.currentSample.t);
  const segments = showSectors
    ? computeSectorSegments(allSmp, currentLap, ctx.currentSample.t, ctx.laps)
    : null;

  if (segments && segments.length === 3) {
    // Base track line (faint)
    c.beginPath();
    for (let i = 0; i < allSmp.length; i++) {
      const x = toX(allSmp[i].lon);
      const y = toY(allSmp[i].lat);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.strokeStyle = theme.ringColor(inst.colorMode);
    c.lineWidth = 1.5;
    c.stroke();

    // Colored sector segments
    for (const seg of segments) {
      const startI = Math.max(0, seg.startIdx);
      const endI = Math.min(allSmp.length - 1, seg.endIdx);
      if (endI <= startI) continue;

      c.beginPath();
      for (let i = startI; i <= endI; i++) {
        const x = toX(allSmp[i].lon);
        const y = toY(allSmp[i].lat);
        if (i === startI) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.strokeStyle = SECTOR_COLORS[seg.status];
      c.lineWidth = 3;
      c.stroke();
    }
  } else {
    // Default single-color track line
    c.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const x = toX(samples[i].lon);
      const y = toY(samples[i].lat);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.strokeStyle = theme.ringColor(inst.colorMode);
    c.lineWidth = 2;
    c.stroke();
  }

  // Position dot (glow themes blur it)
  const current = ctx.currentSample;
  if (current) {
    c.save();
    if (theme.glowFilter) {
      c.shadowColor = theme.accent(inst.colorMode);
      c.shadowBlur = 6;
    }
    c.beginPath();
    c.arc(toX(current.lon), toY(current.lat), size * 0.035, 0, Math.PI * 2);
    c.fillStyle = theme.accent(inst.colorMode);
    c.fill();
    c.restore();
  }
}

export function drawPace(
  c: CanvasRenderingContext2D,
  inst: OverlayInstance,
  ctx: OverlayRenderContext,
  l: OverlayLayout,
  labels: OverlayLabels,
) {
  const theme = getTheme(inst.theme);
  const f = l.fontSize;
  const paceValue = ctx.paceData[ctx.currentIndex] ?? null;

  const maxDelta = memoPaceMax(ctx.paceData);

  const barW = f * 10;
  const { w: totalW, h: totalH } = measureOverlay(inst, ctx, f);
  const barH = f * 0.7;

  c.fillStyle = theme.bg(inst.colorMode, inst.opacity);
  roundRect(c, l.x, l.y, totalW, totalH, f * 0.2);
  c.fill();
  c.strokeStyle = theme.border(inst.colorMode);
  c.lineWidth = 1;
  c.stroke();

  const fraction = paceValue !== null ? Math.max(-1, Math.min(1, paceValue / maxDelta)) : 0;
  const isGood = paceValue !== null && paceValue < 0;
  const displayVal = paceValue !== null ? `${paceValue > 0 ? "+" : ""}${paceValue.toFixed(3)}s` : "—";

  // Value text
  c.fillStyle = isGood ? "#22c55e" : paceValue !== null && paceValue > 0 ? "#ef4444" : theme.text(inst.colorMode);
  c.font = `bold ${f * 0.65}px "JetBrains Mono", monospace`;
  c.textAlign = "center";
  c.textBaseline = "top";
  c.fillText(displayVal, l.x + totalW / 2, l.y + f * 0.2);

  // Bar track
  const barX = l.x + f * 0.3;
  const barY = l.y + f * 0.2 + f * 0.65 + f * 0.1;
  c.fillStyle = theme.ringColor(inst.colorMode);
  roundRect(c, barX, barY, barW, barH, barH / 2);
  c.fill();

  // Fill (under the center line, like the old preview's stacking)
  if (paceValue !== null) {
    c.fillStyle = isGood ? "#22c55e" : "#ef4444";
    if (fraction > 0) {
      // Positive pace (slower) fills left from center toward the SLOW label
      const fw = fraction * barW / 2;
      roundRect(c, barX + barW / 2 - fw, barY, fw, barH, barH / 2);
    } else {
      // Negative pace (faster) fills right from center toward the FAST label
      const fw = Math.abs(fraction) * barW / 2;
      roundRect(c, barX + barW / 2, barY, fw, barH, barH / 2);
    }
    c.fill();
  }

  // Center line
  c.fillStyle = theme.textSecondary(inst.colorMode);
  c.fillRect(barX + barW / 2 - 1, barY, 2, barH);

  // SLOW / FAST labels
  c.fillStyle = theme.textSecondary(inst.colorMode);
  c.font = `${f * 0.35}px "JetBrains Mono", monospace`;
  c.textBaseline = "top";
  const labelY = barY + barH + f * 0.05;
  c.textAlign = "left";
  c.fillText(labels.slow, barX, labelY);
  c.textAlign = "right";
  c.fillText(labels.fast, barX + barW, labelY);
}

export function drawSector(c: CanvasRenderingContext2D, inst: OverlayInstance, ctx: OverlayRenderContext, l: OverlayLayout) {
  const theme = getTheme(inst.theme);
  const f = l.fontSize;
  const t = ctx.currentSample.t;
  const currentLap = findCurrentLap(ctx.laps, ctx.selectedLapNumber, t);
  const states = computeSectorDisplayStates(ctx.laps, currentLap, t);
  const showAnimation = inst.showAnimation !== false;

  const sectorW = f * 3;
  const sectorH = f * 1.6;
  const gap = f * 0.2;

  for (let i = 0; i < 3; i++) {
    const sx = l.x + i * (sectorW + gap);
    const st = states[i];

    c.fillStyle = SECTOR_CELL_BG[st.status];
    roundRect(c, sx, l.y, sectorW, sectorH, f * 0.2);
    c.fill();
    if (st.status === "best") {
      c.strokeStyle = "rgba(168,85,247,0.4)";
      c.lineWidth = 1;
      c.stroke();
    }

    // Completion sweep, in data time: identical in preview and export.
    const completedAgo = st.completedAtMs !== null ? t - st.completedAtMs : -1;
    if (showAnimation && completedAgo >= 0 && completedAgo < SECTOR_SWEEP_MS) {
      const p = completedAgo / SECTOR_SWEEP_MS;
      const bandW = sectorW * 0.35;
      c.save();
      roundRect(c, sx, l.y, sectorW, sectorH, f * 0.2);
      c.clip();
      c.fillStyle = "rgba(255,255,255,0.25)";
      c.fillRect(sx - bandW + p * (sectorW + 2 * bandW), l.y, bandW, sectorH);
      c.restore();
    }

    const isOutlap = st.status === "outlap";
    const textColor = isOutlap ? theme.textSecondary(inst.colorMode) : "#ffffff";
    const delta =
      st.status === "active" ? "•••"
      : st.deltaMs === null ? "—"
      : `${st.deltaMs >= 0 ? "+" : ""}${(st.deltaMs / 1000).toFixed(3)}`;

    // S1/S2/S3 label
    c.fillStyle = isOutlap ? textColor : "rgba(255,255,255,0.7)";
    c.font = `${f * 0.35}px "JetBrains Mono", monospace`;
    c.textAlign = "center";
    c.textBaseline = "top";
    c.fillText(`S${i + 1}`, sx + sectorW / 2, l.y + f * 0.12);

    // Delta value
    c.fillStyle = textColor;
    c.font = `bold ${f * 0.65}px "JetBrains Mono", monospace`;
    c.textBaseline = "bottom";
    c.fillText(delta, sx + sectorW / 2, l.y + sectorH - f * 0.12);
  }
}

export function drawLapTime(
  c: CanvasRenderingContext2D,
  inst: OverlayInstance,
  ctx: OverlayRenderContext,
  l: OverlayLayout,
  labels: OverlayLabels,
) {
  const theme = getTheme(inst.theme);
  const showPace = inst.showPaceMode ?? false;

  const lapStartMs = getOverlayLapStartTime(ctx.samples, ctx.laps, ctx.selectedLapNumber);
  const currentTimeSec = lapStartMs != null ? Math.max(0, (ctx.currentSample.t - lapStartMs) / 1000) : 0;
  const lapTimeStr = formatOverlayLapTime(currentTimeSec);

  const { w: boxW, h: boxH } = measureOverlay(inst, ctx, l.fontSize);

  // Background
  c.fillStyle = theme.bg(inst.colorMode, inst.opacity);
  roundRect(c, l.x, l.y, boxW, boxH, l.fontSize * 0.25);
  c.fill();
  c.strokeStyle = theme.border(inst.colorMode);
  c.lineWidth = 1;
  c.stroke();

  // Lap time
  c.fillStyle = theme.text(inst.colorMode);
  c.font = `bold ${l.fontSize * 1.1}px "JetBrains Mono", monospace`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(lapTimeStr, l.x + boxW / 2, l.y + l.fontSize * 0.75);

  // Label
  c.fillStyle = theme.textSecondary(inst.colorMode);
  c.font = `${l.fontSize * 0.35}px "JetBrains Mono", monospace`;
  c.fillText(labels.lapTime, l.x + boxW / 2, l.y + l.fontSize * 1.35);

  if (showPace) {
    // Divider
    const divY = l.y + l.fontSize * 1.65;
    c.strokeStyle = theme.border(inst.colorMode);
    c.beginPath();
    c.moveTo(l.x + l.fontSize * 0.3, divY);
    c.lineTo(l.x + boxW - l.fontSize * 0.3, divY);
    c.stroke();

    // Pace delta
    const paceValue = ctx.paceData[ctx.currentIndex] ?? null;
    const paceStr = paceValue !== null
      ? `${paceValue > 0 ? "+" : ""}${paceValue.toFixed(3)}s`
      : "—";
    const paceColor = paceValue !== null
      ? (paceValue < 0 ? "#22c55e" : paceValue > 0 ? "#ef4444" : theme.text(inst.colorMode))
      : theme.textSecondary(inst.colorMode);

    c.fillStyle = paceColor;
    c.font = `bold ${l.fontSize * 0.6}px "JetBrains Mono", monospace`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(paceStr, l.x + boxW * 0.3, l.y + l.fontSize * 2.2);

    c.fillStyle = theme.textSecondary(inst.colorMode);
    c.font = `${l.fontSize * 0.28}px "JetBrains Mono", monospace`;
    c.fillText(labels.delta, l.x + boxW * 0.3, l.y + l.fontSize * 2.7);

    // Best lap
    let bestTimeStr = "—";
    let bestLapLabel = "";
    if (ctx.laps.length > 0) {
      let best = ctx.laps[0];
      for (const la of ctx.laps) {
        if (la.lapTimeMs < best.lapTimeMs) best = la;
      }
      bestTimeStr = formatOverlayLapTime(best.lapTimeMs / 1000);
      bestLapLabel = `L${best.lapNumber}`;
    }

    c.fillStyle = theme.text(inst.colorMode);
    c.font = `bold ${l.fontSize * 0.6}px "JetBrains Mono", monospace`;
    c.fillText(bestTimeStr, l.x + boxW * 0.7, l.y + l.fontSize * 2.2);

    c.fillStyle = theme.textSecondary(inst.colorMode);
    c.font = `${l.fontSize * 0.28}px "JetBrains Mono", monospace`;
    c.fillText(labels.best(bestLapLabel), l.x + boxW * 0.7, l.y + l.fontSize * 2.7);
  }
}

/** Helper: begin a rounded rect path (uses native Canvas roundRect) */
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}
