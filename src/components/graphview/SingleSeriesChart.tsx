import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { GpsSample } from '@/types/racing';
import { G_FORCE_FIELDS, applySmoothingToValues, buildSeriesPoints, computeSmoothingWindowSize, detectSpeedGlitchIndices, interpolateGlitchSpeed, numericExtent } from '@/lib/chartUtils';
import { prepare2dCanvas, strokeSeriesPath } from '@/lib/canvas2d';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { usePlaybackContext } from '@/contexts/PlaybackContext';
import { getChartColors } from '@/lib/chartColors';
import { buildChartAxis } from '@/lib/chartAxis';
import { isDistanceUnitChannel, distanceChannelValue, distanceChannelUnit } from '@/lib/units';
import { alignByDistance, alignValuesByDistance } from '@/lib/referenceUtils';
import { computeBrakingGSeriesSG, gToBrakePercent } from '@/lib/brakingZones';
import type { OverlayLine } from '@/lib/lapOverlays';
import { GraphResizeHandle } from './GraphResizeHandle';

/** Default height (px) for a single-series chart card. */
export const SINGLE_SERIES_DEFAULT_HEIGHT = 180;

interface SingleSeriesChartProps {
  samples: GpsSample[];
  seriesKey: string; // "speed", "__pace__", "__braking_g__", or field name from extraFields
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
  samples, seriesKey, onScrub,
  color, label, onDelete,
  referenceValues = null, brakingGValues,
  allSamples, rangeStart, overlayLines = [],
  height, onHeightChange,
}: SingleSeriesChartProps) {
  const { t } = useTranslation('session');
  const { useKph, useMetricDistance, gForceSmoothing, gForceSmoothingStrength, darkMode, chartXAxis, brakingZoneSettings } = useSettingsContext();
  const { currentIndex } = usePlaybackContext();
  const chartColors = useMemo(() => getChartColors(darkMode), [darkMode]);
  const axis = useMemo(
    () => buildChartAxis(samples, chartXAxis, { useMetricDistance, fullSamples: allSamples, rangeStart }),
    [samples, chartXAxis, useMetricDistance, allSamples, rangeStart],
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
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
  // Distance-family channels (distance, altitude) are stored in meters but
  // follow the distance unit toggle (m ⇄ ft).
  const isDist = isDistanceUnitChannel(seriesKey);
  const toDist = useCallback(
    (v: number | undefined) => (isDist && v !== undefined ? distanceChannelValue(v, useMetricDistance) : v),
    [isDist, useMetricDistance],
  );

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
    return samples.map(s => toDist(s.extraFields[seriesKey]));
  }, [samples, seriesKey, isSpeed, isPace, isBrakingG, useKph, referenceValues, brakingGValues, toDist]);

  // Reference values, converted onto the same distance unit as the live series.
  const refValues = useMemo(() => {
    if (!referenceValues || !isDist) return referenceValues;
    return referenceValues.map(v => (v === null ? null : distanceChannelValue(v, useMetricDistance)));
  }, [referenceValues, isDist, useMetricDistance]);

  // Apply smoothing for G-force fields
  const values = useMemo(() => {
    if (isGForce && smoothingWindowSize > 1) {
      return applySmoothingToValues(rawValues, smoothingWindowSize);
    }
    return rawValues;
  }, [rawValues, isGForce, smoothingWindowSize]);

  // Distance-align each overlay lap's value for this series onto the current
  // lap. The synthetic pace series is reference-relative, so it can't overlay;
  // brake % is derived per-lap (computed below), every other series reads
  // straight off the sample.
  const overlaySeries = useMemo(() => {
    if (isPace) return [];
    const full = allSamples ?? samples;
    if (overlayLines.length === 0 || full.length === 0) return [];
    const start = rangeStart ?? 0;
    const end = start + samples.length;
    if (isBrakingG) {
      // Derive each overlay lap's brake % from its own samples, then align it
      // onto the current lap's distance axis (mirrors the reference brake line).
      return overlayLines.map((line) => {
        const brakePct = gToBrakePercent(
          computeBrakingGSeriesSG(line.samples, brakingZoneSettings.graphWindow),
          brakingZoneSettings.brakeMaxG,
        );
        const values = alignValuesByDistance(full, line.samples, brakePct).slice(start, end);
        return { id: line.id, color: line.color, label: line.label, values };
      });
    }
    const getValue = isSpeed
      ? (s: GpsSample) => (useKph ? s.speedKph : s.speedMph)
      : (s: GpsSample) => toDist(s.extraFields[seriesKey]);
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
  }, [overlayLines, allSamples, samples, rangeStart, isSpeed, isPace, isBrakingG, isGForce, seriesKey, useKph, toDist, smoothingWindowSize, brakingZoneSettings.graphWindow, brakingZoneSettings.brakeMaxG]);

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

  // Draw the static layer: grid, axes, and every data line. The playback
  // cursor lives on a second canvas (effect below), so a cursor tick doesn't
  // re-stroke the full-resolution paths — must NOT depend on currentIndex.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0 || dimensions.height === 0 || samples.length === 0) return;
    const ctx = prepare2dCanvas(canvas, dimensions.width, dimensions.height, window.devicePixelRatio || 1);
    if (!ctx) return;

    const padding = { left: 55, right: 15, top: 30, bottom: 25 };
    const chartWidth = dimensions.width - padding.left - padding.right;
    const chartHeight = dimensions.height - padding.top - padding.bottom;
    const toX = (frac: number) => padding.left + frac * chartWidth;

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
    const mainExtent = numericExtent(values);
    if (!mainExtent) return;
    let { min: minVal, max: maxVal } = mainExtent;

    // Expand range to fit reference values
    if (refValues && !isPace) {
      const refExtent = numericExtent(refValues);
      if (refExtent) {
        minVal = Math.min(minVal, refExtent.min);
        maxVal = Math.max(maxVal, refExtent.max);
      }
    }

    // Expand range to fit overlay lap values too
    for (const overlay of overlaySeries) {
      const overlayExtent = numericExtent(overlay.values);
      if (overlayExtent) {
        minVal = Math.min(minVal, overlayExtent.min);
        maxVal = Math.max(maxVal, overlayExtent.max);
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

    const toY = (v: number) => padding.top + (1 - (v - minVal) / range) * chartHeight;

    // Draw reference line (behind main line)
    if (refValues && !isPace) {
      ctx.strokeStyle = chartColors.refLine;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      strokeSeriesPath(ctx, buildSeriesPoints(refValues, axis.fracAt, chartWidth), toX, toY);
      ctx.setLineDash([]);
    }

    // Draw overlay lap lines (behind the main line — current lap stays on top)
    for (const overlay of overlaySeries) {
      ctx.strokeStyle = overlay.color;
      ctx.lineWidth = 1.5;
      strokeSeriesPath(ctx, buildSeriesPoints(overlay.values, axis.fracAt, chartWidth), toX, toY);
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

    // Draw main line — speed glitches interpolated, then decimated to the
    // pixel grid (the old loop also rebuilt the speeds array per glitch index).
    const drawValues: (number | undefined)[] = new Array(samples.length);
    const speeds = isSpeed && interpolateIndices.size > 0
      ? samples.map(s => useKph ? s.speedKph : s.speedMph)
      : null;
    let lastValidSpeed: number | null = null;
    let lastValidIndex = 0;
    for (let i = 0; i < samples.length; i++) {
      let val = values[i];
      if (val === undefined) { drawValues[i] = undefined; continue; }
      if (speeds && interpolateIndices.has(i) && i > 0 && i < samples.length - 1) {
        val = interpolateGlitchSpeed(i, speeds, interpolateIndices, lastValidSpeed, lastValidIndex);
      } else if (isSpeed) {
        lastValidSpeed = val;
        lastValidIndex = i;
      }
      drawValues[i] = val;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    strokeSeriesPath(ctx, buildSeriesPoints(drawValues, axis.fracAt, chartWidth), toX, toY);

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
  }, [samples, values, dimensions, color, isSpeed, isPace, isBrakingG, useKph, interpolateIndices, refValues, chartColors, axis, overlaySeries]);

  // Playback cursor + value tooltip on a separate overlay canvas — the only
  // per-tick cost is clearRect + a line + a small text box.
  useEffect(() => {
    const canvas = cursorCanvasRef.current;
    if (!canvas || dimensions.width === 0 || dimensions.height === 0) return;
    const ctx = prepare2dCanvas(canvas, dimensions.width, dimensions.height, window.devicePixelRatio || 1);
    if (!ctx) return;
    ctx.clearRect(0, 0, dimensions.width, dimensions.height);

    const padding = { left: 55, right: 15, top: 30, bottom: 25 };
    const chartWidth = dimensions.width - padding.left - padding.right;
    const chartHeight = dimensions.height - padding.top - padding.bottom;

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
        const unit = isPace ? 's' : isBrakingG ? 'G' : isSpeed ? (useKph ? ' kph' : ' mph') : isDist ? ` ${distanceChannelUnit(useMetricDistance)}` : '';
        const prefix = (isPace || isBrakingG) && displayVal > 0 ? '+' : '';
        const mainText = `${prefix}${displayVal.toFixed((isPace || isBrakingG) ? 2 : 1)}${unit}`;

        // Delta text (difference from reference at same point)
        let deltaText = '';
        if (refValues && !isPace) {
          const refVal = refValues[currentIndex];
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
  }, [currentIndex, samples.length, values, dimensions, color, isPace, isBrakingG, isSpeed, isDist, useKph, useMetricDistance, refValues, chartColors, axis, overlaySeries]);

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
        title={t('graphs.removeGraph')}
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <div
        ref={containerRef}
        className="relative flex-1 w-full min-h-0 overflow-hidden cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleMouseUp}
      >
        <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" />
        <canvas ref={cursorCanvasRef} className="absolute inset-0 block w-full h-full pointer-events-none" />
      </div>
      <GraphResizeHandle
        height={cardHeight}
        onResize={setCardHeight}
        onCommit={(h) => { setCardHeight(h); onHeightChange?.(h); }}
      />
    </div>
  );
}
