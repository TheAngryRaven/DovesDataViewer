/**
 * Canvas-based overlay renderer for video export.
 * Draws simplified versions of each overlay type directly to a canvas context
 * so overlays appear in exported videos without needing DOM rendering.
 */

import type { OverlayInstance, OverlayRenderContext } from "@/components/video-overlays/types";
import { getTheme } from "@/components/video-overlays/themes";
import { resolveValue, resolveRange, resolveUnit } from "@/components/video-overlays/dataSourceResolver";
import { computeBestSectors, computeSectorSegments, SECTOR_COLORS } from "@/components/video-overlays/sectorUtils";
import { courseHasSectors } from "@/types/racing";
import { findCurrentLap, formatOverlayLapTime, getOverlayLapStartTime } from "@/components/video-overlays/overlayUtils";

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
    // Opacity is already baked into theme.bg() RGBA values — do NOT set globalAlpha
    // here, or backgrounds get double-opacity and text/lines become semi-transparent
    // (mismatching the React preview which has no globalAlpha).

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
  const value = resolveValue(inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, ctx.brakingGData);
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
  const value = resolveValue(inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, ctx.brakingGData);
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
  const value = resolveValue(inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, ctx.brakingGData);
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
  const valueX = resolveValue(inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, ctx.brakingGData);
  const valueY = resolveValue(inst.dataSourceSecondary ?? inst.dataSource, ctx.currentSample, ctx.currentIndex, ctx.dataSources, ctx.paceData, ctx.brakingGData);
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

  c.lineCap = "round";
  c.lineJoin = "round";

  const showSectors = inst.showSectors === true && courseHasSectors(ctx.course);

  if (showSectors) {
    const currentLap = findCurrentLap(ctx.laps, ctx.selectedLapNumber, ctx.currentSample.t);
    const segments = computeSectorSegments(samples, currentLap, ctx.currentSample.t, ctx.laps);

    // Base track line (faint)
    c.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const x = toX(samples[i].lon);
      const y = toY(samples[i].lat);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.strokeStyle = theme.ringColor(inst.colorMode);
    c.lineWidth = 1.5;
    c.stroke();

    // Colored sector segments
    for (const seg of segments) {
      const startI = Math.max(0, seg.startIdx);
      const endI = Math.min(samples.length - 1, seg.endIdx);
      if (endI <= startI) continue;

      c.beginPath();
      for (let i = startI; i <= endI; i++) {
        const x = toX(samples[i].lon);
        const y = toY(samples[i].lat);
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
    if (fraction > 0) {
      // Positive pace (slower) fills left from center toward SLOW label
      const fw = fraction * barW / 2;
      roundRect(c, barX + barW / 2 - fw, barY, fw, barH, barH / 2);
    } else {
      // Negative pace (faster) fills right from center toward FAST label
      const fw = Math.abs(fraction) * barW / 2;
      roundRect(c, barX + barW / 2, barY, fw, barH, barH / 2);
    }
    c.fill();
  }
}

function drawSector(c: CanvasRenderingContext2D, inst: OverlayInstance, ctx: OverlayRenderContext, l: OverlayLayout) {
  const theme = getTheme(inst.theme);

  const best = computeBestSectors(ctx.laps);
  const t = ctx.currentSample.t;
  const currentLap = findCurrentLap(ctx.laps, ctx.selectedLapNumber, t);

  const sectorW = l.fontSize * 3;
  const sectorH = l.fontSize * 1.6;
  const gap = l.fontSize * 0.2;

  // Build time-aware sector states (mirrors SectorOverlay.tsx logic)
  interface SState { bg: string; textColor: string; delta: string; }
  const states: SState[] = [];

  if (!currentLap?.sectors) {
    for (let i = 0; i < 3; i++) {
      states.push({ bg: "rgba(128,128,128,0.25)", textColor: theme.textSecondary(inst.colorMode), delta: "—" });
    }
  } else {
    const s = currentLap.sectors;
    const lapStart = currentLap.startTime;
    const isFirstLap = currentLap.lapNumber === 1;

    const s1Time = s.s1 !== undefined && s.s1 > 0 ? s.s1 : 0;
    const s2Time = s.s2 !== undefined && s.s2 > 0 ? s.s2 : 0;
    const s3Time = s.s3 !== undefined && s.s3 > 0 ? s.s3 : 0;

    const s2Crossing = s1Time > 0 ? lapStart + s1Time : Infinity;
    const s3Crossing = s2Time > 0 ? s2Crossing + s2Time : Infinity;
    const lapEnd = currentLap.endTime;

    const buildResult = (sectorTime: number, bestTime: number): SState => {
      const isFirst = isFirstLap && bestTime === sectorTime;
      if (isFirst) return { bg: "rgba(34,197,94,0.7)", textColor: "#ffffff", delta: "0.000" };
      if (sectorTime <= bestTime) return { bg: "rgba(168,85,247,0.7)", textColor: "#ffffff", delta: `${((sectorTime - bestTime) / 1000).toFixed(3)}` };
      return { bg: "rgba(239,68,68,0.7)", textColor: "#ffffff", delta: `+${((sectorTime - bestTime) / 1000).toFixed(3)}` };
    };
    const outlap: SState = { bg: "rgba(128,128,128,0.25)", textColor: theme.textSecondary(inst.colorMode), delta: "—" };
    const active: SState = { bg: "rgba(59,130,246,0.5)", textColor: "#ffffff", delta: "•••" };

    // S1
    if (t < s2Crossing && s1Time > 0) states.push(active);
    else if (s1Time > 0) states.push(buildResult(s1Time, best.s1));
    else states.push(outlap);

    // S2
    if (t < s2Crossing) states.push(outlap);
    else if (t < s3Crossing && s2Time > 0) states.push(active);
    else if (s2Time > 0) states.push(buildResult(s2Time, best.s2));
    else states.push(outlap);

    // S3
    if (t < s3Crossing) states.push(outlap);
    else if (t < lapEnd && s3Time > 0) states.push(active);
    else if (s3Time > 0) states.push(buildResult(s3Time, best.s3));
    else states.push(outlap);
  }

  for (let i = 0; i < 3; i++) {
    const sx = l.x + i * (sectorW + gap);
    const st = states[i];

    c.fillStyle = st.bg;
    roundRect(c, sx, l.y, sectorW, sectorH, l.fontSize * 0.2);
    c.fill();

    // S1/S2/S3 label
    c.fillStyle = st.textColor === "#ffffff" ? "rgba(255,255,255,0.7)" : st.textColor;
    c.font = `${l.fontSize * 0.35}px "JetBrains Mono", monospace`;
    c.textAlign = "center";
    c.textBaseline = "top";
    c.fillText(`S${i + 1}`, sx + sectorW / 2, l.y + l.fontSize * 0.12);

    // Delta value
    c.fillStyle = st.textColor;
    c.font = `bold ${l.fontSize * 0.65}px "JetBrains Mono", monospace`;
    c.textBaseline = "bottom";
    c.fillText(st.delta, sx + sectorW / 2, l.y + sectorH - l.fontSize * 0.12);
  }
}

function drawLapTime(c: CanvasRenderingContext2D, inst: OverlayInstance, ctx: OverlayRenderContext, l: OverlayLayout) {
  const theme = getTheme(inst.theme);
  const showPace = inst.showPaceMode ?? false;

  const lapStartMs = getOverlayLapStartTime(ctx.samples, ctx.laps, ctx.selectedLapNumber);
  const currentTimeSec = lapStartMs != null ? Math.max(0, (ctx.currentSample.t - lapStartMs) / 1000) : 0;
  const lapTimeStr = formatOverlayLapTime(currentTimeSec);

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
      bestTimeStr = formatOverlayLapTime(best.lapTimeMs / 1000);
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

/** Helper: begin a rounded rect path (uses native Canvas roundRect) */
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}
