/**
 * Canvas-based overlay renderer for video export.
 * Draws simplified versions of each overlay type directly to a canvas context
 * so overlays appear in exported videos without needing DOM rendering.
 */

import type { OverlayInstance, OverlayRenderContext, DataSourceDef } from "@/components/video-overlays/types";
import { getTheme } from "@/components/video-overlays/themes";
import { resolveValue, resolveRange, resolveUnit, resolveLabel } from "@/components/video-overlays/dataSourceResolver";
import type { SectorTimes } from "@/types/racing";

const START_ANGLE = Math.PI * 0.8;
const END_ANGLE = Math.PI * 2.2;
const SWEEP = END_ANGLE - START_ANGLE;

interface OverlayLayout {
  x: number; // px
  y: number; // px
  fontSize: number; // px
  scale: number;
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
  return { x, y, fontSize, scale };
}

/**
 * Render all visible overlays to a canvas context.
 * Called once per frame during export.
 */
export function renderOverlaysToCanvas(
  ctx2d: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlays: OverlayInstance[],
  renderCtx: OverlayRenderContext,
  graphHistories: Map<string, number[]>,
): void {
  for (const overlay of overlays) {
    if (!overlay.visible) continue;
    const layout = computeLayout(overlay, width, height);

    ctx2d.save();
    ctx2d.globalAlpha = overlay.opacity;

    switch (overlay.type) {
      case "digital":
        drawDigital(ctx2d, overlay, renderCtx, layout);
        break;
      case "analog":
        drawAnalog(ctx2d, overlay, renderCtx, layout);
        break;
      case "graph":
        drawGraph(ctx2d, overlay, renderCtx, layout, graphHistories);
        break;
      case "bar":
        drawBar(ctx2d, overlay, renderCtx, layout);
        break;
      case "bubble":
        drawBubble(ctx2d, overlay, renderCtx, layout);
        break;
      case "map":
        drawMap(ctx2d, overlay, renderCtx, layout);
        break;
      case "pace":
        drawPace(ctx2d, overlay, renderCtx, layout);
        break;
      case "sector":
        drawSector(ctx2d, overlay, renderCtx, layout);
        break;
      case "laptime":
        drawLapTime(ctx2d, overlay, renderCtx, layout);
        break;
    }

    ctx2d.restore();
  }
}

function formatLapTimeCanvas(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  const whole = Math.floor(secs);
  const ms = Math.round((secs - whole) * 1000);
  if (mins > 0) {
    return `${mins}:${String(whole).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
  }
  return `${whole}.${String(ms).padStart(3, "0")}`;
}

function getLapStartTimeCanvas(ctx: OverlayRenderContext): number | undefined {
  if (ctx.selectedLapNumber == null || ctx.laps.length === 0) {
    return ctx.samples.length > 0 ? ctx.samples[0].t : undefined;
  }
  const lap = ctx.laps.find((l) => l.lapNumber === ctx.selectedLapNumber);
  return lap?.startTime;
}

function drawDigital(c: CanvasRenderingContext2D, inst: OverlayInstance, ctx: OverlayRenderContext, l: OverlayLayout) {
  const theme = getTheme(inst.theme);
  const value = resolveValue(inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, ctx.brakingGData);
  const unit = resolveUnit(inst.dataSource, ctx.dataSources);
  const displayVal = value !== null ? value.toFixed(1) : "—";

  const textW = displayVal.length * l.fontSize * 0.65 + unit.length * l.fontSize * 0.35 + l.fontSize * 0.6;
  const h = l.fontSize * 1.5;

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

function drawAnalog(c: CanvasRenderingContext2D, inst: OverlayInstance, ctx: OverlayRenderContext, l: OverlayLayout) {
  const theme = getTheme(inst.theme);
  const value = resolveValue(inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData);
  const { min, max } = resolveRange(inst.dataSource, ctx.samples, ctx.dataSources, ctx.paceData);
  const unit = resolveUnit(inst.dataSource, ctx.dataSources);

  const size = Math.round(l.fontSize * 5);
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

  // Needle
  if (value !== null) {
    const range = max - min || 1;
    const fraction = Math.max(0, Math.min(1, (value - min) / range));
    const needleAngle = START_ANGLE + fraction * SWEEP;
    const needleLen = r * 0.85;
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(cx + Math.cos(needleAngle) * needleLen, cy + Math.sin(needleAngle) * needleLen);
    c.strokeStyle = theme.needleColor(inst.colorMode);
    c.lineWidth = size * 0.025;
    c.lineCap = "round";
    c.stroke();
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

function drawGraph(
  c: CanvasRenderingContext2D,
  inst: OverlayInstance,
  ctx: OverlayRenderContext,
  l: OverlayLayout,
  histories: Map<string, number[]>,
) {
  const theme = getTheme(inst.theme);
  const value = resolveValue(inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData);
  const { min, max } = resolveRange(inst.dataSource, ctx.samples, ctx.dataSources, ctx.paceData);
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

  const w = Math.round(l.fontSize * 10);
  const h = Math.round(l.fontSize * 4);
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

function drawBar(c: CanvasRenderingContext2D, inst: OverlayInstance, ctx: OverlayRenderContext, l: OverlayLayout) {
  const theme = getTheme(inst.theme);
  const value = resolveValue(inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData);
  const { min, max } = resolveRange(inst.dataSource, ctx.samples, ctx.dataSources, ctx.paceData);
  const unit = resolveUnit(inst.dataSource, ctx.dataSources);
  const range = max - min || 1;
  const fraction = value !== null ? Math.max(0, Math.min(1, (value - min) / range)) : 0;
  const barColor = inst.color ?? theme.accent(inst.colorMode);
  const displayVal = value !== null ? value.toFixed(1) : "—";

  const barW = l.fontSize * 8;
  const totalW = barW + l.fontSize * 0.6;
  const barH = l.fontSize * 0.6;
  const totalH = l.fontSize * 1.6;

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

function drawBubble(c: CanvasRenderingContext2D, inst: OverlayInstance, ctx: OverlayRenderContext, l: OverlayLayout) {
  const theme = getTheme(inst.theme);
  const valueX = resolveValue(inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData);
  const valueY = resolveValue(inst.dataSourceSecondary ?? inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData);
  const rangeX = resolveRange(inst.dataSource, ctx.samples, ctx.dataSources, ctx.paceData);
  const rangeY = resolveRange(inst.dataSourceSecondary ?? inst.dataSource, ctx.samples, ctx.dataSources, ctx.paceData);

  const size = Math.round(l.fontSize * 6);
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

  // Data point
  if (valueX !== null && valueY !== null) {
    const xR = Math.max(Math.abs(rangeX.min), Math.abs(rangeX.max)) || 1;
    const yR = Math.max(Math.abs(rangeY.min), Math.abs(rangeY.max)) || 1;
    const px = cx + (valueX / xR) * outerR * 0.9;
    const py = cy - (valueY / yR) * outerR * 0.9;
    c.beginPath();
    c.arc(px, py, size * 0.04, 0, Math.PI * 2);
    c.fillStyle = theme.accent(inst.colorMode);
    c.fill();

    c.fillStyle = theme.text(inst.colorMode);
    c.font = `bold ${size * 0.07}px "JetBrains Mono", monospace`;
    c.textAlign = "center";
    c.fillText(`${valueX.toFixed(2)} / ${valueY.toFixed(2)}`, cx, cy + outerR + size * 0.08);
  }
}

function drawMap(c: CanvasRenderingContext2D, inst: OverlayInstance, ctx: OverlayRenderContext, l: OverlayLayout) {
  const theme = getTheme(inst.theme);
  const size = Math.round(l.fontSize * 6);
  const samples = ctx.allSamples;
  if (samples.length < 2) return;

  const pad = size * 0.08;

  // Background
  c.fillStyle = theme.bg(inst.colorMode, inst.opacity);
  roundRect(c, l.x, l.y, size, size, l.fontSize * 0.2);
  c.fill();
  c.strokeStyle = theme.border(inst.colorMode);
  c.lineWidth = 1;
  c.stroke();

  // Bounds
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const s of samples) {
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lon < minLon) minLon = s.lon;
    if (s.lon > maxLon) maxLon = s.lon;
  }
  const latRange = maxLat - minLat || 0.001;
  const lonRange = maxLon - minLon || 0.001;
  const plotSize = size - pad * 2;
  const scale = Math.min(plotSize / lonRange, plotSize / latRange);
  const offsetX = l.x + pad + (plotSize - lonRange * scale) / 2;
  const offsetY = l.y + pad + (plotSize - latRange * scale) / 2;
  const toX = (lon: number) => offsetX + (lon - minLon) * scale;
  const toY = (lat: number) => offsetY + (maxLat - lat) * scale;

  // Track line
  c.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const x = toX(samples[i].lon);
    const y = toY(samples[i].lat);
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.strokeStyle = theme.ringColor(inst.colorMode);
  c.lineWidth = 2;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.stroke();

  // Position dot
  const current = ctx.currentSample;
  if (current) {
    c.beginPath();
    c.arc(toX(current.lon), toY(current.lat), size * 0.035, 0, Math.PI * 2);
    c.fillStyle = theme.accent(inst.colorMode);
    c.fill();
  }
}

function drawPace(c: CanvasRenderingContext2D, inst: OverlayInstance, ctx: OverlayRenderContext, l: OverlayLayout) {
  const theme = getTheme(inst.theme);
  const paceValue = ctx.paceData[ctx.currentIndex] ?? null;

  let maxDelta = 0.5;
  for (const v of ctx.paceData) {
    if (Math.abs(v) > maxDelta) maxDelta = Math.abs(v);
  }
  maxDelta = Math.min(maxDelta * 1.2, 5);

  const barW = l.fontSize * 10;
  const totalW = barW + l.fontSize * 0.6;
  const totalH = l.fontSize * 2;
  const barH = l.fontSize * 0.7;

  c.fillStyle = theme.bg(inst.colorMode, inst.opacity);
  roundRect(c, l.x, l.y, totalW, totalH, l.fontSize * 0.2);
  c.fill();
  c.strokeStyle = theme.border(inst.colorMode);
  c.lineWidth = 1;
  c.stroke();

  const fraction = paceValue !== null ? Math.max(-1, Math.min(1, paceValue / maxDelta)) : 0;
  const isGood = paceValue !== null && paceValue < 0;
  const displayVal = paceValue !== null ? `${paceValue > 0 ? "+" : ""}${paceValue.toFixed(3)}s` : "—";

  // Value text
  c.fillStyle = isGood ? "#22c55e" : paceValue !== null && paceValue > 0 ? "#ef4444" : theme.text(inst.colorMode);
  c.font = `bold ${l.fontSize * 0.65}px "JetBrains Mono", monospace`;
  c.textAlign = "center";
  c.textBaseline = "top";
  c.fillText(displayVal, l.x + totalW / 2, l.y + l.fontSize * 0.15);

  // Bar track
  const barY = l.y + totalH - barH - l.fontSize * 0.3;
  const barX = l.x + l.fontSize * 0.3;
  c.fillStyle = theme.ringColor(inst.colorMode);
  roundRect(c, barX, barY, barW, barH, barH / 2);
  c.fill();

  // Center line
  c.fillStyle = theme.textSecondary(inst.colorMode);
  c.fillRect(barX + barW / 2 - 1, barY, 2, barH);

  // Fill
  if (paceValue !== null) {
    const fillColor = isGood ? "#22c55e" : "#ef4444";
    c.fillStyle = fillColor;
    if (fraction < 0) {
      const fw = Math.abs(fraction) * barW / 2;
      roundRect(c, barX + barW / 2 - fw, barY, fw, barH, barH / 2);
    } else {
      const fw = fraction * barW / 2;
      roundRect(c, barX + barW / 2, barY, fw, barH, barH / 2);
    }
    c.fill();
  }
}

function drawSector(c: CanvasRenderingContext2D, inst: OverlayInstance, ctx: OverlayRenderContext, l: OverlayLayout) {
  const theme = getTheme(inst.theme);

  // Compute best sectors
  const best = { s1: Infinity, s2: Infinity, s3: Infinity };
  for (const lap of ctx.laps) {
    if (!lap.sectors) continue;
    if (lap.sectors.s1 !== undefined && lap.sectors.s1 < best.s1) best.s1 = lap.sectors.s1;
    if (lap.sectors.s2 !== undefined && lap.sectors.s2 < best.s2) best.s2 = lap.sectors.s2;
    if (lap.sectors.s3 !== undefined && lap.sectors.s3 < best.s3) best.s3 = lap.sectors.s3;
  }

  // Find current lap
  const t = ctx.currentSample.t;
  let currentLap = ctx.selectedLapNumber !== null
    ? ctx.laps.find(lap => lap.lapNumber === ctx.selectedLapNumber) ?? null
    : null;
  if (!currentLap) {
    for (const lap of ctx.laps) {
      if (t >= lap.startTime && t <= lap.endTime) { currentLap = lap; break; }
    }
  }

  const sectorW = l.fontSize * 3;
  const sectorH = l.fontSize * 1.6;
  const gap = l.fontSize * 0.2;

  const keys: (keyof SectorTimes)[] = ["s1", "s2", "s3"];
  const bestKeys: ("s1" | "s2" | "s3")[] = ["s1", "s2", "s3"];

  for (let i = 0; i < 3; i++) {
    const sx = l.x + i * (sectorW + gap);
    let bgColor = "rgba(128,128,128,0.25)";
    let textColor = theme.textSecondary(inst.colorMode);
    let deltaStr = "—";

    if (currentLap?.sectors) {
      const val = currentLap.sectors[keys[i]];
      const bestVal = best[bestKeys[i]];
      if (val !== undefined && val > 0) {
        const isFirst = currentLap.lapNumber === 1 && bestVal === val;
        if (isFirst) {
          bgColor = "rgba(34,197,94,0.7)";
          textColor = "#ffffff";
          deltaStr = "0.000";
        } else if (val <= bestVal) {
          bgColor = "rgba(168,85,247,0.7)";
          textColor = "#ffffff";
          deltaStr = `${((val - bestVal) / 1000).toFixed(3)}`;
        } else {
          bgColor = "rgba(239,68,68,0.7)";
          textColor = "#ffffff";
          deltaStr = `+${((val - bestVal) / 1000).toFixed(3)}`;
        }
      }
    }

    c.fillStyle = bgColor;
    roundRect(c, sx, l.y, sectorW, sectorH, l.fontSize * 0.2);
    c.fill();

    // S1/S2/S3 label
    c.fillStyle = textColor === "#ffffff" ? "rgba(255,255,255,0.7)" : textColor;
    c.font = `${l.fontSize * 0.35}px "JetBrains Mono", monospace`;
    c.textAlign = "center";
    c.textBaseline = "top";
    c.fillText(`S${i + 1}`, sx + sectorW / 2, l.y + l.fontSize * 0.12);

    // Delta value
    c.fillStyle = textColor;
    c.font = `bold ${l.fontSize * 0.65}px "JetBrains Mono", monospace`;
    c.textBaseline = "bottom";
    c.fillText(deltaStr, sx + sectorW / 2, l.y + sectorH - l.fontSize * 0.12);
  }
}

function drawLapTime(c: CanvasRenderingContext2D, inst: OverlayInstance, ctx: OverlayRenderContext, l: OverlayLayout) {
  const theme = getTheme(inst.theme);
  const showPace = inst.showPaceMode ?? false;

  // Get lap start time
  let lapStartMs: number | undefined;
  if (ctx.selectedLapNumber != null && ctx.laps.length > 0) {
    const lap = ctx.laps.find((la) => la.lapNumber === ctx.selectedLapNumber);
    lapStartMs = lap?.startTime;
  }
  if (lapStartMs == null && ctx.samples.length > 0) {
    lapStartMs = ctx.samples[0].t;
  }

  const currentTimeSec = lapStartMs != null ? Math.max(0, (ctx.currentSample.t - lapStartMs) / 1000) : 0;
  const lapTimeStr = formatLapTimeCanvas(currentTimeSec);

  const boxW = l.fontSize * (showPace ? 8 : 5);
  const boxH = l.fontSize * (showPace ? 3.2 : 2);

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
  c.fillText("LAP TIME", l.x + boxW / 2, l.y + l.fontSize * 1.35);

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
    c.fillText("DELTA", l.x + boxW * 0.3, l.y + l.fontSize * 2.7);

    // Best lap
    let bestTimeStr = "—";
    let bestLabel = "BEST";
    if (ctx.laps.length > 0) {
      let best = ctx.laps[0];
      for (const la of ctx.laps) {
        if (la.lapTimeMs < best.lapTimeMs) best = la;
      }
      bestTimeStr = formatLapTimeCanvas(best.lapTimeMs / 1000);
      bestLabel = `BEST L${best.lapNumber}`;
    }

    c.fillStyle = theme.text(inst.colorMode);
    c.font = `bold ${l.fontSize * 0.6}px "JetBrains Mono", monospace`;
    c.fillText(bestTimeStr, l.x + boxW * 0.7, l.y + l.fontSize * 2.2);

    c.fillStyle = theme.textSecondary(inst.colorMode);
    c.font = `${l.fontSize * 0.28}px "JetBrains Mono", monospace`;
    c.fillText(bestLabel, l.x + boxW * 0.7, l.y + l.fontSize * 2.7);
  }
}

/** Helper: draw a rounded rect path */
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h);
  c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r);
  c.arcTo(x, y, x + r, y, r);
  c.closePath();
}
