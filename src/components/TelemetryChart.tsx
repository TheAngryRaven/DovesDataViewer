import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { GpsSample, FieldMapping } from '@/types/racing';
import { G_FORCE_FIELDS, applySmoothingToValues, computeSmoothingWindowSize, detectSpeedGlitchIndices, interpolateGlitchSpeed } from '@/lib/chartUtils';

interface TelemetryChartProps {
  samples: GpsSample[];
  fieldMappings: FieldMapping[];
  currentIndex: number;
  onScrub: (index: number) => void;
  onFieldToggle: (fieldName: string) => void;
  useKph?: boolean;
  paceData?: (number | null)[];
  referenceSpeedData?: (number | null)[];
  hasReference?: boolean;
  gForceSmoothing?: boolean;
  gForceSmoothingStrength?: number;
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
  currentIndex, 
  onScrub,
  onFieldToggle,
  useKph = false,
  paceData = [],
  referenceSpeedData = [],
  hasReference = false,
  gForceSmoothing = true,
  gForceSmoothingStrength = 50
}: TelemetryChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
  const getSpeed = (sample: GpsSample) => useKph ? sample.speedKph : sample.speedMph;

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
  const enabledFields = fieldMappings.filter(f => f.enabled);

  // Draw chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0 || dimensions.height === 0) return;
    if (samples.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    ctx.scale(dpr, dpr);

    const padding = { left: 60, right: 20, top: 20, bottom: 30 };
    const chartWidth = dimensions.width - padding.left - padding.right;
    const chartHeight = dimensions.height - padding.top - padding.bottom;

    // Clear
    ctx.fillStyle = 'hsl(220, 18%, 10%)';
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    // Draw grid
    ctx.strokeStyle = 'hsl(220, 15%, 20%)';
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
    const maxSpeed = Math.ceil(Math.max(...speeds) / 10) * 10;
    const minSpeed = 0;

    // Draw reference speed line first (underneath, grey, dashed)
    if (hasReference && showReferenceSpeed && referenceSpeedData.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = REFERENCE_COLOR;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);

      let isDrawing = false;
      for (let i = 0; i < samples.length; i++) {
        const refSpeed = referenceSpeedData[i];
        if (refSpeed === null || refSpeed === undefined) {
          isDrawing = false;
          continue;
        }

        const x = padding.left + (i / (samples.length - 1)) * chartWidth;
        const y = padding.top + (1 - (refSpeed - minSpeed) / (maxSpeed - minSpeed)) * chartHeight;

        if (!isDrawing) {
          ctx.moveTo(x, y);
          isDrawing = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw speed line - smart glitch filtering
    const allSpeeds = samples.map(s => getSpeed(s));
    const interpolateIndices = detectSpeedGlitchIndices(allSpeeds);

    ctx.beginPath();
    ctx.strokeStyle = COLORS[0];
    ctx.lineWidth = 2;

    let lastValidSpeed: number | null = null;
    let lastValidIndex = 0;

    for (let i = 0; i < samples.length; i++) {
      const x = padding.left + (i / (samples.length - 1)) * chartWidth;
      let speed = allSpeeds[i];

      if (interpolateIndices.has(i) && i > 0 && i < samples.length - 1) {
        speed = interpolateGlitchSpeed(i, allSpeeds, interpolateIndices, lastValidSpeed, lastValidIndex);
      } else {
        lastValidSpeed = speed;
        lastValidIndex = i;
      }

      const y = padding.top + (1 - (speed - minSpeed) / (maxSpeed - minSpeed)) * chartHeight;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Draw extra fields
    enabledFields.forEach((field, fieldIndex) => {
      // Use smoothed data for G-force fields
      const isGForceField = G_FORCE_FIELDS.includes(field.name);
      const rawValues = samples.map(s => s.extraFields[field.name]);
      const values = isGForceField 
        ? smoothedGForceData[field.name] || rawValues
        : rawValues;
      
      const numericValues = values.filter((v): v is number => v !== undefined);
      if (numericValues.length === 0) return;
      
      const maxVal = Math.max(...numericValues);
      const minVal = Math.min(...numericValues);
      const range = maxVal - minVal || 1;

      // Keep colors stable regardless of enabled/disabled state
      const mappingIndex = fieldMappings.findIndex(f => f.name === field.name);
      const colorIndex = ((mappingIndex === -1 ? fieldIndex : mappingIndex) + 1) % COLORS.length;
      
      ctx.beginPath();
      ctx.strokeStyle = COLORS[colorIndex];
      ctx.lineWidth = 1.5;

      let isDrawing = false;
      
      for (let i = 0; i < samples.length; i++) {
        const val = values[i];
        
        if (val === undefined) {
          isDrawing = false;
          continue;
        }
        
        const x = padding.left + (i / (samples.length - 1)) * chartWidth;
        const y = padding.top + (1 - (val - minVal) / range) * chartHeight;
        
        if (!isDrawing) {
          ctx.moveTo(x, y);
          isDrawing = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    });

    // Draw pace chart (secondary axis area at bottom of chart)
    if (hasReference && showPace && paceData.length > 0) {
      // Find pace range, ensuring 0 is included
      const validPaces = paceData.filter((p): p is number => p !== null);
      if (validPaces.length > 0) {
        const maxPace = Math.max(...validPaces, 0);
        const minPace = Math.min(...validPaces, 0);
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
        
        // Draw pace line
        ctx.beginPath();
        ctx.strokeStyle = PACE_COLOR;
        ctx.lineWidth = 2;
        
        let isDrawing = false;
        for (let i = 0; i < samples.length; i++) {
          const pace = paceData[i];
          if (pace === null) {
            isDrawing = false;
            continue;
          }
          
          const x = padding.left + (i / (samples.length - 1)) * chartWidth;
          // Pace: positive = slower (below zero line), negative = faster (above zero line)
          // Normalize to use full chart height
          const normalizedPace = pace / paceExtent; // -1 to 1
          const y = padding.top + ((1 - (-normalizedPace)) / 2) * chartHeight;
          
          if (!isDrawing) {
            ctx.moveTo(x, y);
            isDrawing = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        
        // Fill area under/over zero
        ctx.beginPath();
        ctx.fillStyle = paceData[currentIndex] !== null && paceData[currentIndex]! > 0 
          ? 'hsla(0, 60%, 50%, 0.1)' // Red tint when behind
          : 'hsla(120, 60%, 50%, 0.1)'; // Green tint when ahead
        
        let firstX = padding.left;
        for (let i = 0; i < samples.length; i++) {
          const pace = paceData[i];
          if (pace === null) continue;
          
          const x = padding.left + (i / (samples.length - 1)) * chartWidth;
          const normalizedPace = pace / paceExtent;
          const y = padding.top + ((1 - (-normalizedPace)) / 2) * chartHeight;
          
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
        ctx.fill();
      }
    }

    // Draw Y axis labels (speed)
    ctx.fillStyle = 'hsl(220, 10%, 55%)';
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

    // Draw X axis labels (time)
    ctx.textAlign = 'center';
    const startTime = samples[0].t / 1000;
    const endTime = samples[samples.length - 1].t / 1000;
    const duration = endTime - startTime;
    
    for (let i = 0; i <= timeGridCount; i++) {
      const time = (duration / timeGridCount) * i;
      const x = padding.left + (chartWidth / timeGridCount) * i;
      const minutes = Math.floor(time / 60);
      const seconds = (time % 60).toFixed(0).padStart(2, '0');
      ctx.fillText(`${minutes}:${seconds}`, x, dimensions.height - 8);
    }

    // Draw scrub cursor
    if (currentIndex >= 0 && currentIndex < samples.length) {
      const x = padding.left + (currentIndex / (samples.length - 1)) * chartWidth;
      
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + chartHeight);
      ctx.strokeStyle = 'hsl(0, 75%, 55%)';
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
      let boxHeight = 20 + fieldsWithValues.length * 16;
      if (hasReference && showReferenceSpeed && currentRefSpeed !== null) boxHeight += 16;
      if (hasReference && showPace && currentPace !== null) boxHeight += 16;
      
      const boxX = Math.min(x + 10, dimensions.width - 130);
      const boxY = padding.top + 10;
      
      ctx.fillStyle = 'hsla(220, 18%, 10%, 0.9)';
      ctx.fillRect(boxX, boxY, 120, boxHeight);
      ctx.strokeStyle = 'hsl(220, 15%, 25%)';
      ctx.lineWidth = 1;
      ctx.strokeRect(boxX, boxY, 120, boxHeight);

      ctx.fillStyle = COLORS[0];
      ctx.textAlign = 'left';
      ctx.fillText(`Speed: ${currentSpeed.toFixed(1)} ${speedUnit.toLowerCase()}`, boxX + 8, boxY + 14);

      let fieldOffset = 1;
      
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
          ctx.fillText(`${field.name}: ${val.toFixed(1)}`, boxX + 8, boxY + 14 + fieldOffset * 16);
          fieldOffset++;
        }
      });
    }

  }, [samples, currentIndex, dimensions, enabledFields, useKph, speedUnit, paceData, referenceSpeedData, hasReference, showReferenceSpeed, showPace, smoothedGForceData]);

  // Scrub handling
  const handleScrub = useCallback((clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas || samples.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const padding = { left: 60, right: 20 };
    const chartWidth = rect.width - padding.left - padding.right;
    const x = clientX - rect.left - padding.left;
    const ratio = Math.max(0, Math.min(1, x / chartWidth));
    const index = Math.round(ratio * (samples.length - 1));
    onScrub(index);
  }, [samples, onScrub]);

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
          <span className="text-xs font-mono">Speed ({speedUnit})</span>
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
            <span className="text-xs font-mono">Ref Speed</span>
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
            <span className="text-xs font-mono">Pace (Δt)</span>
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
            <span className="text-xs font-mono">{field.name}</span>
          </button>
        ))}
      </div>

      {/* Chart */}
      <div 
        ref={containerRef}
        className="flex-1 min-h-0 w-full overflow-hidden cursor-crosshair"
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
          className="block w-full h-full"
        />
      </div>
    </div>
  );
}
