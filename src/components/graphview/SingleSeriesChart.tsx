import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import { GpsSample } from '@/types/racing';
import { G_FORCE_FIELDS, applySmoothingToValues, computeSmoothingWindowSize, detectSpeedGlitchIndices, interpolateGlitchSpeed } from '@/lib/chartUtils';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { getChartColors } from '@/lib/chartColors';
import { buildChartAxis } from '@/lib/chartAxis';
import { alignByDistance } from '@/lib/referenceUtils';
import type { OverlayLine } from '@/lib/lapOverlays';
import { GraphResizeHandle } from './GraphResizeHandle';

/** Default height (px) for a single-series chart card. */
export const SINGLE_SERIES_DEFAULT_HEIGHT = 180;

interface SingleSeriesChartProps {
  samples: GpsSample[];
  seriesKey: string; // "speed", "__pace__", "__braking_g__", or field name from extraFields
  currentIndex: number;
  onScrub: (index: number) => void;
  color: string;
  label: string;
  onDelete: () => void;
  referenceValues?: (number | null)[] | null;
  brakingGValues?: number[];
  /** Full lap samples + the visible window's start index, for absolute
   *  (start-finish-anchored) X-axis labels while the window stays zoomed. */
  allSamples?: GpsSample[];
  rangeStart?: number;
  /** Extra laps/snapshots to overlay (distance-aligned) for this series. */
  overlayLines?: OverlayLine[];
  /** Committed card height (px); defaults to SINGLE_SERIES_DEFAULT_HEIGHT. */
  height?: number;
  /** Persist a new card height (fired on resize-drag release). */
  onHeightChange?: (height: number) => void;
}

export function SingleSeriesChart({
  samples, seriesKey, currentIndex, onScrub,
  color, label, onDelete,
  referenceValues = null, brakingGValues,
  allSamples, rangeStart, overlayLines = [],
  height, onHeightChange,
}: SingleSeriesChartProps) {
  const { useKph, gForceSmoothing, gForceSmoothingStrength, darkMode, chartXAxis } = useSettingsContext();
  const chartColors = useMemo(() => getChartColors(darkMode), [darkMode]);
  const axis = useMemo(
    () => buildChartAxis(samples, chartXAxis, { useKph, fullSamples: allSamples, rangeStart }),
    [samples, chartXAxis, useKph, allSamples, rangeStart],
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Live card height — driven by the resize handle, seeded from the committed
  // prop and re-synced whenever the parent's value changes.
  const committedHeight = height ?? SINGLE_SERIES_DEFAULT_HEIGHT;
  const [cardHeight, setCardHeight] = useState(committedHeight);
  useEffect(() => { setCardHeight(committedHeight); }, [committedHeight]);

  const isSpeed = seriesKey === 'speed';
  const isPace = seriesKey === '__pace__';
  const isBrakingG = seriesKey === '__braking_g__';
  const isGForce = G_FORCE_FIELDS.includes(seriesKey);

  const smoothingWindowSize = useMemo(() =>
    isGForce ? computeSmoothingWindowSize(gForceSmoothing, gForceSmoothingStrength) : 1,
    [gForceSmoothing, gForceSmoothingStrength, isGForce]);

  // Extract raw values for this series
  const rawValues = useMemo((): (number | undefined)[] => {
    if (isPace && referenceValues) {
      return referenceValues.map(v => v ?? undefined);
    }
    if (isBrakingG && brakingGValues) {
      return brakingGValues.map(v => v);
    }
    if (isSpeed) {
      return samples.map(s => useKph ? s.speedKph : s.speedMph);
    }
    return samples.map(s => s.extraFields[seriesKey]);
  }, [samples, seriesKey, isSpeed, isPace, isBrakingG, useKph, referenceValues, brakingGValues]);

  // Apply smoothing for G-force fields
  const values = useMemo(() => {
    if (isGForce && smoothingWindowSize > 1) {
      return applySmoothingToValues(rawValues, smoothingWindowSize);
    }
    return rawValues;
  }, [rawValues, isGForce, smoothingWindowSize]);

  // Distance-align each overlay lap's value for this series onto the current
  // lap. Only for real measured series (speed / channels) — the synthetic pace
  // and brake-% series are reference-relative / derived, so they don't overlay.
  const overlaySeries = useMemo(() => {
    if (isPace || isBrakingG) return [];
    const full = allSamples ?? samples;
    if (overlayLines.length === 0 || full.length === 0) return [];
    const start = rangeStart ?? 0;
    const end = start + samples.length;
    const getValue = isSpeed
      ? (s: GpsSample) => (useKph ? s.speedKph : s.speedMph)
      : (s: GpsSample) => s.extraFields[seriesKey];
    return overlayLines.map((line) => {
      let values = alignByDistance(full, line.samples, getValue).slice(start, end);
      if (isGForce && smoothingWindowSize > 1) {
        values = applySmoothingToValues(
          values.map((v) => (v === null ? undefined : v)),
          smoothingWindowSize,
        ).map((v) => (v === undefined ? null : v));
      }
      return { id: line.id, color: line.color, label: line.label, values };
    });
  }, [overlayLines, allSamples, samples, rangeStart, isSpeed, isPace, isBrakingG, isGForce, seriesKey, useKph, smoothingWindowSize]);

  // Speed glitch filtering
  const interpolateIndices = useMemo(() => {
    if (!isSpeed) return new Set<number>();
    const speeds = samples.map(s => useKph ? s.speedKph : s.speedMph);
    return detectSpeedGlitchIndices(speeds);
  }, [samples, isSpeed, useKph]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Draw chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0 || dimensions.height === 0 || samples.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    ctx.scale(dpr, dpr);

    const padding = { left: 55, right: 15, top: 30, bottom: 25 };
    const chartWidth = dimensions.width - padding.left - padding.right;
    const chartHeight = dimensions.height - padding.top - padding.bottom;

    // Clear
    ctx.fillStyle = chartColors.background;
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    // Grid
    ctx.strokeStyle = chartColors.grid;
    ctx.lineWidth = 1;
    const timeGridCount = 10;
    for (let i = 0; i <= timeGridCount; i++) {
      const x = padding.left + (chartWidth / timeGridCount) * i;
      ctx.beginPath(); ctx.moveTo(x, padding.top); ctx.lineTo(x, padding.top + chartHeight); ctx.stroke();
    }
    const valueGridCount = 4;
    for (let i = 0; i <= valueGridCount; i++) {
      const y = padding.top + (chartHeight / valueGridCount) * i;
      ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(padding.left + chartWidth, y); ctx.stroke();
    }

    // Compute min/max (include reference values in range)
    const numericValues = values.filter((v): v is number => v !== undefined);
    if (numericValues.length === 0) return;
    let minVal = Math.min(...numericValues);
    let maxVal = Math.max(...numericValues);

    // Expand range to fit reference values
    if (referenceValues && !isPace) {
      const refNums = referenceValues.filter((v): v is number => v !== null);
      if (refNums.length > 0) {
        minVal = Math.min(minVal, ...refNums);
        maxVal = Math.max(maxVal, ...refNums);
      }
    }

    // Expand range to fit overlay lap values too
    for (const overlay of overlaySeries) {
      const nums = overlay.values.filter((v): v is number => v !== null);
      if (nums.length > 0) {
        minVal = Math.min(minVal, ...nums);
        maxVal = Math.max(maxVal, ...nums);
      }
    }

    if (isSpeed) { minVal = 0; maxVal = Math.ceil(maxVal / 10) * 10; }
    if (isBrakingG) { minVal = 0; maxVal = 100; } // 0-100% fixed range
    if (isPace) {
      const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal), 0.5);
      minVal = -absMax;
      maxVal = absMax;
    }
    const range = maxVal - minVal || 1;

    // Draw reference line (behind main line)
    if (referenceValues && !isPace) {
      ctx.beginPath();
      ctx.strokeStyle = chartColors.refLine;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      let refDrawing = false;
      for (let i = 0; i < samples.length; i++) {
        const rv = referenceValues[i];
        if (rv === null || rv === undefined) { refDrawing = false; continue; }
        const x = padding.left + axis.fracAt(i) * chartWidth;
        const y = padding.top + (1 - (rv - minVal) / range) * chartHeight;
        if (!refDrawing) { ctx.moveTo(x, y); refDrawing = true; }
        else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw overlay lap lines (behind the main line — current lap stays on top)
    for (const overlay of overlaySeries) {
      ctx.beginPath();
      ctx.strokeStyle = overlay.color;
      ctx.lineWidth = 1.5;
      let drawing = false;
      for (let i = 0; i < samples.length; i++) {
        const v = overlay.values[i];
        if (v === null || v === undefined) { drawing = false; continue; }
        const x = padding.left + axis.fracAt(i) * chartWidth;
        const y = padding.top + (1 - (v - minVal) / range) * chartHeight;
        if (!drawing) { ctx.moveTo(x, y); drawing = true; } else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
    }

    // Draw zero line for pace and braking G
    if (isPace) {
      const zeroY = padding.top + (1 - (0 - minVal) / range) * chartHeight;
      ctx.beginPath();
      ctx.strokeStyle = chartColors.zeroLine;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(padding.left, zeroY);
      ctx.lineTo(padding.left + chartWidth, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw main line
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    let lastValidSpeed: number | null = null;
    let lastValidIndex = 0;
    let isDrawing = false;

    for (let i = 0; i < samples.length; i++) {
      let val = values[i];
      if (val === undefined) { isDrawing = false; continue; }

      // Speed glitch interpolation
      if (isSpeed && interpolateIndices.has(i) && i > 0 && i < samples.length - 1) {
        const speeds = samples.map(s => useKph ? s.speedKph : s.speedMph);
        val = interpolateGlitchSpeed(i, speeds, interpolateIndices, lastValidSpeed, lastValidIndex);
      } else if (isSpeed) {
        lastValidSpeed = val;
        lastValidIndex = i;
      }

      const x = padding.left + axis.fracAt(i) * chartWidth;
      const y = padding.top + (1 - (val - minVal) / range) * chartHeight;

      if (!isDrawing) { ctx.moveTo(x, y); isDrawing = true; }
      else { ctx.lineTo(x, y); }
    }
    ctx.stroke();

    // Y axis labels
    ctx.fillStyle = chartColors.axisText;
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= valueGridCount; i++) {
      const value = minVal + (range / valueGridCount) * (valueGridCount - i);
      const y = padding.top + (chartHeight / valueGridCount) * i;
      const fmt = (isPace || isBrakingG) ? (value > 0 ? '+' : '') + value.toFixed(isBrakingG ? 2 : 1) : value.toFixed(isSpeed ? 0 : 1);
      ctx.fillText(fmt, padding.left - 6, y + 3);
    }

    // X axis labels (time or distance, per chartXAxis setting)
    ctx.textAlign = 'center';
    for (let i = 0; i <= timeGridCount; i += 2) {
      const x = padding.left + (chartWidth / timeGridCount) * i;
      ctx.fillText(axis.label(i / timeGridCount), x, dimensions.height - 6);
    }

    // Scrub cursor
    if (currentIndex >= 0 && currentIndex < samples.length) {
      const x = padding.left + axis.fracAt(currentIndex) * chartWidth;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + chartHeight);
      ctx.strokeStyle = chartColors.scrubCursor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Current value tooltip — current lap first, then each overlay lap.
      const displayVal = values[currentIndex];
      if (displayVal !== undefined) {
        const unit = isPace ? 's' : isBrakingG ? 'G' : isSpeed ? (useKph ? ' kph' : ' mph') : '';
        const prefix = (isPace || isBrakingG) && displayVal > 0 ? '+' : '';
        const mainText = `${prefix}${displayVal.toFixed((isPace || isBrakingG) ? 2 : 1)}${unit}`;

        // Delta text (difference from reference at same point)
        let deltaText = '';
        if (referenceValues && !isPace) {
          const refVal = referenceValues[currentIndex];
          if (refVal !== null && refVal !== undefined) {
            const delta = displayVal - refVal;
            const sign = delta > 0 ? '+' : '';
            deltaText = `  Δ${sign}${delta.toFixed(1)}`;
          }
        }

        ctx.font = '10px JetBrains Mono, monospace';

        // Overlay rows (value at the cursor for each overlaid lap)
        const overlayRows = overlaySeries
          .map((o) => ({ color: o.color, label: o.label, v: o.values[currentIndex] }))
          .filter((r): r is { color: string; label: string; v: number } => r.v !== null && r.v !== undefined)
          .map((r) => ({
            color: r.color,
            text: `${r.label.length > 16 ? `${r.label.slice(0, 15)}…` : r.label}: ${r.v.toFixed(1)}`,
          }));

        let boxWidth = ctx.measureText(mainText + deltaText).width;
        for (const r of overlayRows) boxWidth = Math.max(boxWidth, ctx.measureText(r.text).width);
        boxWidth = Math.max(90, boxWidth + 12);
        const boxHeight = 18 + overlayRows.length * 14;
        const boxX = Math.min(x + 8, dimensions.width - boxWidth - 10);
        const boxY = padding.top + 4;

        ctx.fillStyle = chartColors.tooltipBg;
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
        ctx.strokeStyle = chartColors.tooltipBorder;
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

        ctx.textAlign = 'left';

        // Main value (current lap, on top)
        ctx.fillStyle = color;
        ctx.fillText(mainText, boxX + 4, boxY + 12);
        if (deltaText) {
          const mainWidth = ctx.measureText(mainText).width;
          ctx.fillStyle = chartColors.deltaText;
          ctx.fillText(deltaText, boxX + 4 + mainWidth, boxY + 12);
        }

        // Overlay rows beneath
        overlayRows.forEach((r, idx) => {
          ctx.fillStyle = r.color;
          ctx.fillText(r.text, boxX + 4, boxY + 12 + (idx + 1) * 14);
        });
      }
    }
  }, [samples, values, currentIndex, dimensions, color, isSpeed, isPace, isBrakingG, useKph, interpolateIndices, referenceValues, chartColors, axis, overlaySeries]);

  // Scrub handling
  const handleScrub = useCallback((clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas || samples.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const padding = { left: 55, right: 15 };
    const chartWidth = rect.width - padding.left - padding.right;
    const x = clientX - rect.left - padding.left;
    const ratio = Math.max(0, Math.min(1, x / chartWidth));
    onScrub(axis.indexAt(ratio));
  }, [samples, onScrub, axis]);

  const handleMouseDown = (e: React.MouseEvent) => { setIsDragging(true); handleScrub(e.clientX); };
  const handleMouseMove = (e: React.MouseEvent) => { if (isDragging) handleScrub(e.clientX); };
  const handleMouseUp = () => setIsDragging(false);
  const handleTouchStart = (e: React.TouchEvent) => { setIsDragging(true); handleScrub(e.touches[0].clientX); };
  const handleTouchMove = (e: React.TouchEvent) => { if (isDragging) handleScrub(e.touches[0].clientX); };

  return (
    <div className="relative border-b border-border flex flex-col" style={{ height: `${cardHeight}px` }}>
      {/* Header */}
      <div className="absolute top-1 left-2 z-10 flex items-center gap-1.5">
        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs font-mono text-muted-foreground">{label}</span>
      </div>
      <button
        onClick={onDelete}
        className="absolute top-1 right-1 z-10 p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
        title="Remove graph"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <div
        ref={containerRef}
        className="flex-1 w-full min-h-0 overflow-hidden cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleMouseUp}
      >
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>
      <GraphResizeHandle
        height={cardHeight}
        onResize={setCardHeight}
        onCommit={(h) => { setCardHeight(h); onHeightChange?.(h); }}
      />
    </div>
  );
}
