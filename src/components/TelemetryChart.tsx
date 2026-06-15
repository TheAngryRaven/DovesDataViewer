import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GpsSample, FieldMapping } from '@/types/racing';
import { G_FORCE_FIELDS, G_FORCE_FIELDS_GPS, G_FORCE_FIELDS_HW, applySmoothingToValues, buildSeriesPoints, computeSmoothingWindowSize, detectSpeedGlitchIndices, interpolateGlitchSpeed, numericExtent } from '@/lib/chartUtils';
import { prepare2dCanvas, strokeSeriesPath } from '@/lib/canvas2d';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { usePlaybackContext } from '@/contexts/PlaybackContext';
import { getChartColors } from '@/lib/chartColors';
import { buildChartAxis } from '@/lib/chartAxis';
import { isDistanceUnitChannel, distanceChannelValue, distanceChannelUnit } from '@/lib/units';
import { alignByDistance } from '@/lib/referenceUtils';
import type { OverlayLine } from '@/lib/lapOverlays';

interface TelemetryChartProps {
  samples: GpsSample[];
  fieldMappings: FieldMapping[];
  onScrub: (index: number) => void;
  onFieldToggle: (fieldName: string) => void;
  paceData?: (number | null)[];
  referenceSpeedData?: (number | null)[];
  hasReference?: boolean;
  /** Full lap samples + the visible window's start index, for absolute
   *  (start-finish-anchored) X-axis labels while the window stays zoomed. */
  allSamples?: GpsSample[];
  rangeStart?: number;
  /** Extra laps/snapshots to overlay as distance-aligned speed lines. */
  overlayLines?: OverlayLine[];
}

const COLORS = [
  'hsl(180, 70%, 55%)', // Cyan - speed
  'hsl(45, 85%, 55%)',  // Yellow - rpm
  'hsl(0, 70%, 55%)',   // Red - temp
  'hsl(280, 60%, 60%)', // Purple
  'hsl(120, 60%, 50%)', // Green
  'hsl(30, 80%, 55%)',  // Orange
  'hsl(200, 80%, 60%)', // Blue - Lat G
  'hsl(340, 80%, 55%)', // Pink - Lon G
];

const REFERENCE_COLOR = 'hsl(220, 10%, 55%)'; // Grey for reference
const PACE_COLOR = 'hsl(35, 90%, 55%)'; // Orange-gold for pace

export function TelemetryChart({
  samples,
  fieldMappings,
  onScrub,
  onFieldToggle,
  paceData = [],
  referenceSpeedData = [],
  hasReference = false,
  allSamples,
  rangeStart,
  overlayLines = [],
}: TelemetryChartProps) {
  const { t } = useTranslation('session');
  const { useKph, useMetricDistance, gForceSmoothing, gForceSmoothingStrength, darkMode, gForceSource, chartXAxis } = useSettingsContext();
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
  const [showReferenceSpeed, setShowReferenceSpeed] = useState(true);
  const [showPace, setShowPace] = useState(true);

  const smoothingWindowSize = useMemo(() =>
    computeSmoothingWindowSize(gForceSmoothing, gForceSmoothingStrength),
    [gForceSmoothing, gForceSmoothingStrength]);

  // Pre-compute smoothed G-force values
  const smoothedGForceData = useMemo(() => {
    const result: Record<string, (number | undefined)[]> = {};
    
    for (const fieldName of G_FORCE_FIELDS) {
      const rawValues = samples.map(s => s.extraFields[fieldName]);
      result[fieldName] = applySmoothingToValues(rawValues, smoothingWindowSize);
    }
    
    return result;
  }, [samples, smoothingWindowSize]);

  const speedUnit = useKph ? 'KPH' : 'MPH';
  const getSpeed = useCallback((sample: GpsSample) => useKph ? sample.speedKph : sample.speedMph, [useKph]);

  // Distance-align each overlay lap's speed onto the current lap, sliced to the
  // visible window (computed over the full lap so it stays anchored to the
  // start-finish line, like the reference). Recomputed only when inputs change.
  const overlaySpeed = useMemo(() => {
    const full = allSamples ?? samples;
    if (overlayLines.length === 0 || full.length === 0) return [];
    const start = rangeStart ?? 0;
    const end = start + samples.length;
    return overlayLines.map((line) => ({
      id: line.id,
      color: line.color,
      label: line.label,
      values: alignByDistance(full, line.samples, (s) => (useKph ? s.speedKph : s.speedMph)).slice(start, end),
    }));
  }, [overlayLines, allSamples, samples, rangeStart, useKph]);

  // Handle resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Get enabled fields
  // Filter out G-force fields based on source preference
  const hiddenGForceFields = gForceSource === 'hw' ? G_FORCE_FIELDS_GPS : G_FORCE_FIELDS_HW;
  const enabledFields = fieldMappings.filter(f => f.enabled && !hiddenGForceFields.includes(f.name));

  // Draw the static layer: grid, axes, and every data line. The playback
  // cursor lives on a second canvas (effect below), so a cursor tick doesn't
  // re-stroke 100k-point paths — this effect must NOT depend on currentIndex.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0 || dimensions.height === 0) return;
    if (samples.length === 0) return;

    const ctx = prepare2dCanvas(canvas, dimensions.width, dimensions.height, window.devicePixelRatio || 1);
    if (!ctx) return;

    const padding = { left: 60, right: 20, top: 20, bottom: 30 };
    const chartWidth = dimensions.width - padding.left - padding.right;
    const chartHeight = dimensions.height - padding.top - padding.bottom;
    const toX = (frac: number) => padding.left + frac * chartWidth;

    // Clear
    ctx.fillStyle = chartColors.background;
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    // Draw grid
    ctx.strokeStyle = chartColors.grid;
    ctx.lineWidth = 1;

    // Vertical grid (time)
    const timeGridCount = 10;
    for (let i = 0; i <= timeGridCount; i++) {
      const x = padding.left + (chartWidth / timeGridCount) * i;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + chartHeight);
      ctx.stroke();
    }

    // Horizontal grid
    const valueGridCount = 5;
    for (let i = 0; i <= valueGridCount; i++) {
      const y = padding.top + (chartHeight / valueGridCount) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartWidth, y);
      ctx.stroke();
    }

    // Find speed range
    const speeds = samples.map(s => getSpeed(s));
    const maxSpeed = Math.ceil((numericExtent(speeds)?.max ?? 0) / 10) * 10;
    const minSpeed = 0;

    const toSpeedY = (v: number) => padding.top + (1 - (v - minSpeed) / (maxSpeed - minSpeed)) * chartHeight;

    // Draw reference speed line first (underneath, grey, dashed)
    if (hasReference && showReferenceSpeed && referenceSpeedData.length > 0) {
      ctx.strokeStyle = REFERENCE_COLOR;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      strokeSeriesPath(ctx, buildSeriesPoints(referenceSpeedData, axis.fracAt, chartWidth), toX, toSpeedY);
      ctx.setLineDash([]);
    }

    // Draw overlay lap speed lines (other laps / snapshots), beneath the current
    // lap so the current lap always stays on top.
    for (const overlay of overlaySpeed) {
      ctx.strokeStyle = overlay.color;
      ctx.lineWidth = 1.5;
      strokeSeriesPath(ctx, buildSeriesPoints(overlay.values, axis.fracAt, chartWidth), toX, toSpeedY);
    }

    // Draw speed line — glitch-interpolated, then decimated to the pixel grid
    const interpolateIndices = detectSpeedGlitchIndices(speeds);
    const drawSpeeds = new Array<number>(samples.length);
    let lastValidSpeed: number | null = null;
    let lastValidIndex = 0;
    for (let i = 0; i < samples.length; i++) {
      let speed = speeds[i];
      if (interpolateIndices.has(i) && i > 0 && i < samples.length - 1) {
        speed = interpolateGlitchSpeed(i, speeds, interpolateIndices, lastValidSpeed, lastValidIndex);
      } else {
        lastValidSpeed = speed;
        lastValidIndex = i;
      }
      drawSpeeds[i] = speed;
    }
    ctx.strokeStyle = COLORS[0];
    ctx.lineWidth = 2;
    strokeSeriesPath(ctx, buildSeriesPoints(drawSpeeds, axis.fracAt, chartWidth), toX, toSpeedY);

    // Draw extra fields
    enabledFields.forEach((field, fieldIndex) => {
      // Use smoothed data for G-force fields
      const isGForceField = G_FORCE_FIELDS.includes(field.name);
      const rawValues = samples.map(s => s.extraFields[field.name]);
      const values = isGForceField 
        ? smoothedGForceData[field.name] || rawValues
        : rawValues;
      
      const extent = numericExtent(values);
      if (!extent) return;

      const minVal = extent.min;
      const range = extent.max - extent.min || 1;

      // Keep colors stable regardless of enabled/disabled state
      const mappingIndex = fieldMappings.findIndex(f => f.name === field.name);
      const colorIndex = ((mappingIndex === -1 ? fieldIndex : mappingIndex) + 1) % COLORS.length;

      ctx.strokeStyle = COLORS[colorIndex];
      ctx.lineWidth = 1.5;
      strokeSeriesPath(
        ctx,
        buildSeriesPoints(values, axis.fracAt, chartWidth),
        toX,
        (v) => padding.top + (1 - (v - minVal) / range) * chartHeight,
      );
    });

    // Draw pace chart (secondary axis area at bottom of chart)
    if (hasReference && showPace && paceData.length > 0) {
      // Find pace range, ensuring 0 is included
      const paceRange = numericExtent(paceData);
      if (paceRange) {
        const maxPace = Math.max(paceRange.max, 0);
        const minPace = Math.min(paceRange.min, 0);
        // Make symmetric around 0 if possible
        const paceExtent = Math.max(Math.abs(maxPace), Math.abs(minPace), 0.5);
        
        // Draw pace zero line
        const zeroY = padding.top + chartHeight / 2;
        ctx.beginPath();
        ctx.strokeStyle = 'hsl(220, 15%, 30%)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.moveTo(padding.left, zeroY);
        ctx.lineTo(padding.left + chartWidth, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Pace: positive = slower (below zero line), negative = faster (above)
        const toPaceY = (pace: number) => padding.top + ((1 - (-(pace / paceExtent))) / 2) * chartHeight;

        // Draw pace line
        ctx.strokeStyle = PACE_COLOR;
        ctx.lineWidth = 2;
        strokeSeriesPath(ctx, buildSeriesPoints(paceData, axis.fracAt, chartWidth), toX, toPaceY);

        // Fill the area between the pace curve and the zero line, tinted by
        // sign per region (red where behind, green where ahead). Region-based
        // so it stays on the static layer — the old whole-area tint keyed on
        // the pace at the cursor, which would force this fill every tick.
        const tracePaceFill = () => {
          ctx.beginPath();
          let firstX = padding.left;
          for (let i = 0; i < samples.length; i++) {
            const pace = paceData[i];
            if (pace === null) continue;
            const x = toX(axis.fracAt(i));
            const y = toPaceY(pace);
            if (i === 0 || paceData[i - 1] === null) {
              ctx.moveTo(x, zeroY);
              ctx.lineTo(x, y);
              firstX = x;
            } else {
              ctx.lineTo(x, y);
            }
          }
          // Close to zero line
          ctx.lineTo(padding.left + chartWidth, zeroY);
          ctx.lineTo(firstX, zeroY);
          ctx.closePath();
        };
        const fillPaceRegion = (clipTop: number, clipHeight: number, style: string) => {
          if (clipHeight <= 0) return;
          ctx.save();
          ctx.beginPath();
          ctx.rect(padding.left, clipTop, chartWidth, clipHeight);
          ctx.clip();
          tracePaceFill();
          ctx.fillStyle = style;
          ctx.fill();
          ctx.restore();
        };
        fillPaceRegion(padding.top, zeroY - padding.top, 'hsla(120, 60%, 50%, 0.1)'); // ahead
        fillPaceRegion(zeroY, padding.top + chartHeight - zeroY, 'hsla(0, 60%, 50%, 0.1)'); // behind
      }
    }

    // Draw Y axis labels (speed)
    ctx.fillStyle = chartColors.axisText;
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    
    for (let i = 0; i <= valueGridCount; i++) {
      const value = minSpeed + ((maxSpeed - minSpeed) / valueGridCount) * (valueGridCount - i);
      const y = padding.top + (chartHeight / valueGridCount) * i;
      ctx.fillText(value.toFixed(0), padding.left - 8, y + 4);
    }

    // Y axis label
    ctx.save();
    ctx.translate(12, padding.top + chartHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(speedUnit, 0, 0);
    ctx.restore();

    // Draw X axis labels (time or distance, per chartXAxis setting)
    ctx.textAlign = 'center';
    for (let i = 0; i <= timeGridCount; i++) {
      const x = padding.left + (chartWidth / timeGridCount) * i;
      ctx.fillText(axis.label(i / timeGridCount), x, dimensions.height - 8);
    }
  }, [samples, dimensions, enabledFields, useKph, speedUnit, paceData, referenceSpeedData, hasReference, showReferenceSpeed, showPace, smoothedGForceData, chartColors, fieldMappings, getSpeed, axis, overlaySpeed]);

  // Draw the playback cursor + value tooltip on a separate overlay canvas.
  // This is the only work a playback tick costs: clearRect + a line + a small
  // text box, instead of re-stroking the whole chart.
  useEffect(() => {
    const canvas = cursorCanvasRef.current;
    if (!canvas || dimensions.width === 0 || dimensions.height === 0) return;

    const ctx = prepare2dCanvas(canvas, dimensions.width, dimensions.height, window.devicePixelRatio || 1);
    if (!ctx) return;
    ctx.clearRect(0, 0, dimensions.width, dimensions.height);

    const padding = { left: 60, right: 20, top: 20, bottom: 30 };
    const chartWidth = dimensions.width - padding.left - padding.right;
    const chartHeight = dimensions.height - padding.top - padding.bottom;

    ctx.font = '11px JetBrains Mono, monospace';

    if (currentIndex >= 0 && currentIndex < samples.length) {
      const x = padding.left + axis.fracAt(currentIndex) * chartWidth;
      
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + chartHeight);
      ctx.strokeStyle = chartColors.scrubCursor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Current values box
      const currentSpeed = getSpeed(samples[currentIndex]);
      const currentRefSpeed = hasReference && referenceSpeedData[currentIndex];
      const currentPace = hasReference && paceData[currentIndex];
      
      // Calculate box height
      const fieldsWithValues = enabledFields.filter(f =>
        samples[currentIndex].extraFields[f.name] !== undefined
      );
      const overlayRows = overlaySpeed.filter(o => o.values[currentIndex] != null);
      let boxHeight = 20 + fieldsWithValues.length * 16 + overlayRows.length * 16;
      if (hasReference && showReferenceSpeed && currentRefSpeed !== null) boxHeight += 16;
      if (hasReference && showPace && currentPace !== null) boxHeight += 16;

      const boxW = overlayRows.length > 0 ? 168 : 120;
      const boxX = Math.min(x + 10, dimensions.width - boxW - 10);
      const boxY = padding.top + 10;

      ctx.fillStyle = chartColors.tooltipBg;
      ctx.fillRect(boxX, boxY, boxW, boxHeight);
      ctx.strokeStyle = chartColors.tooltipBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(boxX, boxY, boxW, boxHeight);

      ctx.fillStyle = COLORS[0];
      ctx.textAlign = 'left';
      ctx.fillText(`Speed: ${currentSpeed.toFixed(1)} ${speedUnit.toLowerCase()}`, boxX + 8, boxY + 14);

      let fieldOffset = 1;

      // Overlay laps (current lap shown first, above) — each in its line color.
      for (const overlay of overlayRows) {
        const v = overlay.values[currentIndex] as number;
        const label = overlay.label.length > 16 ? `${overlay.label.slice(0, 15)}…` : overlay.label;
        ctx.fillStyle = overlay.color;
        ctx.fillText(`${label}: ${v.toFixed(1)}`, boxX + 8, boxY + 14 + fieldOffset * 16);
        fieldOffset++;
      }

      // Reference speed
      if (hasReference && showReferenceSpeed && currentRefSpeed !== null && currentRefSpeed !== undefined) {
        ctx.fillStyle = REFERENCE_COLOR;
        ctx.fillText(`Ref: ${(currentRefSpeed as number).toFixed(1)} ${speedUnit.toLowerCase()}`, boxX + 8, boxY + 14 + fieldOffset * 16);
        fieldOffset++;
      }
      
      // Pace
      if (hasReference && showPace && currentPace !== null && currentPace !== undefined) {
        const paceValue = currentPace as number;
        const paceSign = paceValue >= 0 ? '+' : '';
        ctx.fillStyle = paceValue >= 0 ? 'hsl(0, 60%, 55%)' : 'hsl(120, 60%, 55%)';
        ctx.fillText(`Pace: ${paceSign}${paceValue.toFixed(3)}s`, boxX + 8, boxY + 14 + fieldOffset * 16);
        fieldOffset++;
      }
      
      enabledFields.forEach((field) => {
        // Use smoothed value for G-force fields in tooltip too
        const isGForceField = G_FORCE_FIELDS.includes(field.name);
        const val = isGForceField 
          ? smoothedGForceData[field.name]?.[currentIndex]
          : samples[currentIndex].extraFields[field.name];
        
        if (val !== undefined) {
          const mappingIndex = fieldMappings.findIndex(f => f.name === field.name);
          const colorIndex = ((mappingIndex === -1 ? 0 : mappingIndex) + 1) % COLORS.length;
          ctx.fillStyle = COLORS[colorIndex];
          // Distance-family channels (distance, altitude) follow the distance unit toggle.
          const isDist = isDistanceUnitChannel(field.name);
          const shown = isDist ? distanceChannelValue(val, useMetricDistance) : val;
          const unitSuffix = isDist ? ` ${distanceChannelUnit(useMetricDistance)}` : '';
          ctx.fillText(`${field.label ?? field.name}: ${shown.toFixed(1)}${unitSuffix}`, boxX + 8, boxY + 14 + fieldOffset * 16);
          fieldOffset++;
        }
      });
    }
  }, [currentIndex, samples, dimensions, enabledFields, useMetricDistance, speedUnit, paceData, referenceSpeedData, hasReference, showReferenceSpeed, showPace, smoothedGForceData, chartColors, fieldMappings, getSpeed, axis, overlaySpeed]);

  // Scrub handling
  const handleScrub = useCallback((clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas || samples.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const padding = { left: 60, right: 20 };
    const chartWidth = rect.width - padding.left - padding.right;
    const x = clientX - rect.left - padding.left;
    const ratio = Math.max(0, Math.min(1, x / chartWidth));
    onScrub(axis.indexAt(ratio));
  }, [samples, onScrub, axis]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    handleScrub(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      handleScrub(e.clientX);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    handleScrub(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isDragging) {
      handleScrub(e.touches[0].clientX);
    }
  };

  return (
    <div className="flex w-full flex-col h-full min-h-0 bg-card">
      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[0] }} />
          <span className="text-xs font-mono">{t('graphs.speed', { unit: speedUnit })}</span>
        </div>
        
        {/* Reference speed toggle - only show when reference is selected */}
        {hasReference && (
          <button
            onClick={() => setShowReferenceSpeed(!showReferenceSpeed)}
            className={`flex items-center gap-2 ${showReferenceSpeed ? '' : 'opacity-40'}`}
          >
            <div 
              className="w-3 h-3 rounded-full border-2 border-dashed" 
              style={{ borderColor: REFERENCE_COLOR, backgroundColor: showReferenceSpeed ? REFERENCE_COLOR : 'transparent' }} 
            />
            <span className="text-xs font-mono">{t('graphs.refSpeed')}</span>
          </button>
        )}
        
        {/* Pace toggle - only show when reference is selected */}
        {hasReference && (
          <button
            onClick={() => setShowPace(!showPace)}
            className={`flex items-center gap-2 ${showPace ? '' : 'opacity-40'}`}
          >
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: showPace ? PACE_COLOR : 'transparent', border: `2px solid ${PACE_COLOR}` }} 
            />
            <span className="text-xs font-mono">{t('graphs.paceDt')}</span>
          </button>
        )}
        
        {fieldMappings.map((field, idx) => (
          <button
            key={field.name}
            onClick={() => onFieldToggle(field.name)}
            className={`flex items-center gap-2 ${field.enabled ? '' : 'opacity-40'}`}
          >
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: COLORS[(idx + 1) % COLORS.length] }} 
            />
            <span className="text-xs font-mono">{field.label ?? field.name}</span>
          </button>
        ))}
      </div>

      {/* Chart: static layer + cursor overlay stacked */}
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 w-full overflow-hidden cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleMouseUp}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 block w-full h-full"
        />
        <canvas
          ref={cursorCanvasRef}
          className="absolute inset-0 block w-full h-full pointer-events-none"
        />
      </div>
    </div>
  );
}
