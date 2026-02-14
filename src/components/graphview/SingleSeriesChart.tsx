import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import { GpsSample } from '@/types/racing';
import { G_FORCE_FIELDS, applySmoothingToValues, computeSmoothingWindowSize, detectSpeedGlitchIndices, interpolateGlitchSpeed } from '@/lib/chartUtils';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { getChartColors } from '@/lib/chartColors';

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
}

export function SingleSeriesChart({
  samples, seriesKey, currentIndex, onScrub,
  color, label, onDelete,
  referenceValues = null, brakingGValues,
}: SingleSeriesChartProps) {
  const { useKph, gForceSmoothing, gForceSmoothingStrength, darkMode } = useSettingsContext();
  const chartColors = useMemo(() => getChartColors(darkMode), [darkMode]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);

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

    if (isSpeed) { minVal = 0; maxVal = Math.ceil(maxVal / 10) * 10; }
    if (isPace || isBrakingG) {
      // Center around zero with symmetric range
      const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal), isPace ? 0.5 : 0.1);
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
        const x = padding.left + (i / (samples.length - 1)) * chartWidth;
        const y = padding.top + (1 - (rv - minVal) / range) * chartHeight;
        if (!refDrawing) { ctx.moveTo(x, y); refDrawing = true; }
        else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw zero line for pace and braking G
    if (isPace || isBrakingG) {
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

      const x = padding.left + (i / (samples.length - 1)) * chartWidth;
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

    // X axis labels (time)
    ctx.textAlign = 'center';
    const startTime = samples[0].t / 1000;
    const endTime = samples[samples.length - 1].t / 1000;
    const duration = endTime - startTime;
    for (let i = 0; i <= timeGridCount; i += 2) {
      const time = (duration / timeGridCount) * i;
      const x = padding.left + (chartWidth / timeGridCount) * i;
      const mins = Math.floor(time / 60);
      const secs = (time % 60).toFixed(0).padStart(2, '0');
      ctx.fillText(`${mins}:${secs}`, x, dimensions.height - 6);
    }

    // Scrub cursor
    if (currentIndex >= 0 && currentIndex < samples.length) {
      const x = padding.left + (currentIndex / (samples.length - 1)) * chartWidth;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + chartHeight);
      ctx.strokeStyle = chartColors.scrubCursor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Current value tooltip
      let displayVal = values[currentIndex];
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

        const fullText = mainText + deltaText;
        const boxWidth = Math.max(90, ctx.measureText(fullText).width + 12);
        const boxX = Math.min(x + 8, dimensions.width - boxWidth - 10);

        ctx.fillStyle = chartColors.tooltipBg;
        ctx.fillRect(boxX, padding.top + 4, boxWidth, 18);
        ctx.strokeStyle = chartColors.tooltipBorder;
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX, padding.top + 4, boxWidth, 18);

        ctx.textAlign = 'left';
        ctx.font = '10px JetBrains Mono, monospace';

        // Draw main value
        ctx.fillStyle = color;
        ctx.fillText(mainText, boxX + 4, padding.top + 16);

        // Draw delta in separate color
        if (deltaText) {
          const mainWidth = ctx.measureText(mainText).width;
          ctx.fillStyle = chartColors.deltaText;
          ctx.fillText(deltaText, boxX + 4 + mainWidth, padding.top + 16);
        }
      }
    }
  }, [samples, values, currentIndex, dimensions, color, isSpeed, isPace, isBrakingG, useKph, interpolateIndices, referenceValues, chartColors]);

  // Scrub handling
  const handleScrub = useCallback((clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas || samples.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const padding = { left: 55, right: 15 };
    const chartWidth = rect.width - padding.left - padding.right;
    const x = clientX - rect.left - padding.left;
    const ratio = Math.max(0, Math.min(1, x / chartWidth));
    onScrub(Math.round(ratio * (samples.length - 1)));
  }, [samples, onScrub]);

  const handleMouseDown = (e: React.MouseEvent) => { setIsDragging(true); handleScrub(e.clientX); };
  const handleMouseMove = (e: React.MouseEvent) => { if (isDragging) handleScrub(e.clientX); };
  const handleMouseUp = () => setIsDragging(false);
  const handleTouchStart = (e: React.TouchEvent) => { setIsDragging(true); handleScrub(e.touches[0].clientX); };
  const handleTouchMove = (e: React.TouchEvent) => { if (isDragging) handleScrub(e.touches[0].clientX); };

  return (
    <div className="relative border-b border-border" style={{ minHeight: '150px', height: '180px' }}>
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
        className="w-full h-full min-h-0 overflow-hidden cursor-crosshair"
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
    </div>
  );
}
