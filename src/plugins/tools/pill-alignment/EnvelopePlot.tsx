// Camber/caster reachable-envelope scatter (plan 0011).
//
// Two stacked canvases (GGDiagram pattern): the static layer holds the ~32k
// swept dots + the two single-pill loci and only redraws when the sweep,
// colors, or geometry change; the overlay holds the current-setpoint marker so
// dial edits and drags never repaint the cloud. Dots are batched per color
// bucket, so the whole cloud costs ≤20 fillStyle changes.

import { useEffect, useMemo, useRef, useState } from "react";
import { getChartColors } from "@/lib/chartColors";
import { prepare2dCanvas } from "@/lib/canvas2d";
import {
  ENVELOPE_BUCKET_COUNT,
  colorBucket,
  colorForBucket,
  colorMetric,
  type EnvelopePoint,
} from "./envelope";
import type { EnvelopeColorMode, PillCalibration, Side, ToeState } from "./model";

interface EnvelopePlotProps {
  points: EnvelopePoint[];
  loci: { top: Array<{ x: number; y: number }>; bottom: Array<{ x: number; y: number }> };
  colorMode: EnvelopeColorMode;
  cal: PillCalibration;
  toe: ToeState;
  side: Side;
  current: { camberDeg: number; casterDeg: number };
  onTarget: (camberDeg: number, casterDeg: number) => void;
  darkMode: boolean;
  xLabel: string;
  yLabel: string;
  legendLabel: string;
}

const TOP_LOCUS_COLOR = "hsl(28, 90%, 55%)"; // orange, matches the reference app
const BOT_LOCUS_COLOR = "hsl(300, 85%, 55%)"; // magenta

const MARGIN = { left: 34, right: 8, top: 8, bottom: 26 };

/** ~5 round-numbered ticks across a range. */
function ticks(min: number, max: number): number[] {
  const span = max - min;
  if (!(span > 0)) return [];
  const raw = span / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => span / s <= 6) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

export function EnvelopePlot({
  points,
  loci,
  colorMode,
  cal,
  toe,
  side,
  current,
  onTarget,
  darkMode,
  xLabel,
  yLabel,
  legendLabel,
}: EnvelopePlotProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const chartColors = useMemo(() => getChartColors(darkMode), [darkMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Data extents padded 10% so boundary dots don't sit on the frame.
  const extents = useMemo(() => {
    if (points.length === 0) return null;
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of points) {
      if (p.camberDeg < xMin) xMin = p.camberDeg;
      if (p.camberDeg > xMax) xMax = p.camberDeg;
      if (p.casterDeg < yMin) yMin = p.casterDeg;
      if (p.casterDeg > yMax) yMax = p.casterDeg;
    }
    const padX = Math.max((xMax - xMin) * 0.1, 0.1);
    const padY = Math.max((yMax - yMin) * 0.1, 0.1);
    return { xMin: xMin - padX, xMax: xMax + padX, yMin: yMin - padY, yMax: yMax + padY };
  }, [points]);

  // Per-point color buckets + the metric extent for the legend.
  const buckets = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    const metrics = new Float64Array(points.length);
    for (let i = 0; i < points.length; i++) {
      const m = colorMetric(points[i], colorMode, cal, toe, side);
      metrics[i] = m;
      if (m < min) min = m;
      if (m > max) max = m;
    }
    const idx = new Uint8Array(points.length);
    for (let i = 0; i < points.length; i++) idx[i] = colorBucket(metrics[i], min, max);
    return { idx, min, max };
  }, [points, colorMode, cal, toe, side]);

  const geometry = useMemo(() => {
    if (!extents) return null;
    const plotW = dimensions.width - MARGIN.left - MARGIN.right;
    const plotH = dimensions.height - MARGIN.top - MARGIN.bottom;
    if (plotW <= 0 || plotH <= 0) return null;
    const sx = (camber: number) => MARGIN.left + ((camber - extents.xMin) / (extents.xMax - extents.xMin)) * plotW;
    const sy = (caster: number) => MARGIN.top + (1 - (caster - extents.yMin) / (extents.yMax - extents.yMin)) * plotH;
    const invert = (px: number, py: number) => ({
      camberDeg: extents.xMin + ((px - MARGIN.left) / plotW) * (extents.xMax - extents.xMin),
      casterDeg: extents.yMin + (1 - (py - MARGIN.top) / plotH) * (extents.yMax - extents.yMin),
    });
    return { sx, sy, invert, plotW, plotH };
  }, [extents, dimensions]);

  // Static layer: grid, axes, dot cloud, loci.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0 || dimensions.height === 0) return;
    const ctx = prepare2dCanvas(canvas, dimensions.width, dimensions.height, window.devicePixelRatio || 1);
    if (!ctx) return;

    ctx.fillStyle = chartColors.background;
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);
    if (!geometry || !extents) return;
    const { sx, sy } = geometry;

    ctx.font = "9px JetBrains Mono, monospace";
    for (const v of ticks(extents.xMin, extents.xMax)) {
      const x = sx(v);
      ctx.strokeStyle = chartColors.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, MARGIN.top);
      ctx.lineTo(x, dimensions.height - MARGIN.bottom);
      ctx.stroke();
      ctx.fillStyle = chartColors.axisText;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(v.toFixed(Math.abs(v) < 10 && v % 1 !== 0 ? 1 : 0), x, dimensions.height - MARGIN.bottom + 3);
    }
    for (const v of ticks(extents.yMin, extents.yMax)) {
      const y = sy(v);
      ctx.strokeStyle = chartColors.grid;
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, y);
      ctx.lineTo(dimensions.width - MARGIN.right, y);
      ctx.stroke();
      ctx.fillStyle = chartColors.axisText;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(v.toFixed(Math.abs(v) < 10 && v % 1 !== 0 ? 1 : 0), MARGIN.left - 4, y);
    }
    // Zero axes, slightly stronger than the grid.
    ctx.strokeStyle = chartColors.zeroLine;
    if (extents.xMin < 0 && extents.xMax > 0) {
      ctx.beginPath();
      ctx.moveTo(sx(0), MARGIN.top);
      ctx.lineTo(sx(0), dimensions.height - MARGIN.bottom);
      ctx.stroke();
    }
    if (extents.yMin < 0 && extents.yMax > 0) {
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, sy(0));
      ctx.lineTo(dimensions.width - MARGIN.right, sy(0));
      ctx.stroke();
    }

    // Dot cloud, one pass per bucket to bound fillStyle churn.
    ctx.globalAlpha = 0.75;
    for (let b = 0; b < ENVELOPE_BUCKET_COUNT; b++) {
      ctx.fillStyle = colorForBucket(b);
      for (let i = 0; i < points.length; i++) {
        if (buckets.idx[i] !== b) continue;
        ctx.fillRect(sx(points[i].camberDeg) - 1, sy(points[i].casterDeg) - 1, 2, 2);
      }
    }
    ctx.globalAlpha = 1;

    // Single-pill loci circles.
    const stroke = (path: Array<{ x: number; y: number }>, color: string) => {
      if (path.length === 0) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx(path[0].x), sy(path[0].y));
      for (let i = 1; i < path.length; i++) ctx.lineTo(sx(path[i].x), sy(path[i].y));
      ctx.stroke();
    };
    stroke(loci.top, TOP_LOCUS_COLOR);
    stroke(loci.bottom, BOT_LOCUS_COLOR);

    // Axis titles.
    ctx.fillStyle = chartColors.axisText;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(xLabel, MARGIN.left + geometry.plotW / 2, dimensions.height - 2);
    ctx.save();
    ctx.translate(9, MARGIN.top + geometry.plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }, [dimensions, geometry, extents, points, buckets, loci, chartColors, xLabel, yLabel]);

  // Overlay layer: the current-setpoint marker only.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || dimensions.width === 0 || dimensions.height === 0) return;
    const ctx = prepare2dCanvas(canvas, dimensions.width, dimensions.height, window.devicePixelRatio || 1);
    if (!ctx) return;
    ctx.clearRect(0, 0, dimensions.width, dimensions.height);
    if (!geometry) return;
    const x = geometry.sx(current.camberDeg);
    const y = geometry.sy(current.casterDeg);
    ctx.strokeStyle = chartColors.scrubCursor;
    ctx.fillStyle = chartColors.background;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 10, y);
    ctx.lineTo(x + 10, y);
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x, y + 10);
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [current, dimensions, geometry, chartColors]);

  // Drag the setpoint: pointer capture so the drag survives leaving the plot.
  const dragging = useRef(false);
  const rafRef = useRef(0);
  const emitTarget = (clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container || !geometry) return;
    const rect = container.getBoundingClientRect();
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const { camberDeg, casterDeg } = geometry.invert(clientX - rect.left, clientY - rect.top);
      onTarget(camberDeg, casterDeg);
    });
  };

  return (
    <div className="space-y-1.5">
      <div
        ref={containerRef}
        className="relative w-full aspect-square max-h-[420px] touch-none rounded border border-border overflow-hidden"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          emitTarget(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (dragging.current) emitTarget(e.clientX, e.clientY);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" />
        <canvas ref={overlayRef} className="absolute inset-0 block w-full h-full pointer-events-none" />
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="tabular-nums">{buckets.min === Infinity ? "" : buckets.min.toFixed(1)}</span>
        <div
          className="h-2 flex-1 rounded"
          style={{
            background: `linear-gradient(to right, ${colorForBucket(0)}, ${colorForBucket(
              Math.floor(ENVELOPE_BUCKET_COUNT / 2),
            )}, ${colorForBucket(ENVELOPE_BUCKET_COUNT - 1)})`,
          }}
        />
        <span className="tabular-nums">{buckets.max === -Infinity ? "" : buckets.max.toFixed(1)}</span>
        <span>{legendLabel}</span>
      </div>
    </div>
  );
}
