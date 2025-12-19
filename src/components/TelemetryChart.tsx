import { useRef, useEffect, useState, useCallback } from 'react';
import { GpsSample, FieldMapping } from '@/types/racing';

interface TelemetryChartProps {
  samples: GpsSample[];
  fieldMappings: FieldMapping[];
  currentIndex: number;
  onScrub: (index: number) => void;
  onFieldToggle: (fieldName: string) => void;
  useKph?: boolean;
}

const COLORS = [
  'hsl(180, 70%, 55%)', // Cyan - speed
  'hsl(45, 85%, 55%)',  // Yellow - rpm
  'hsl(0, 70%, 55%)',   // Red - temp
  'hsl(280, 60%, 60%)', // Purple
  'hsl(120, 60%, 50%)', // Green
  'hsl(30, 80%, 55%)',  // Orange
];

export function TelemetryChart({ 
  samples, 
  fieldMappings, 
  currentIndex, 
  onScrub,
  onFieldToggle,
  useKph = false
}: TelemetryChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);

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

    // Draw speed line - interpolate over GPS glitches (speeds below 1 mph during racing)
    const MIN_SPEED_THRESHOLD = 1.0; // mph/kph - speeds below this are likely GPS glitches
    ctx.beginPath();
    ctx.strokeStyle = COLORS[0];
    ctx.lineWidth = 2;
    
    let lastValidSpeed: number | null = null;
    let lastValidIndex = 0;
    
    for (let i = 0; i < samples.length; i++) {
      const x = padding.left + (i / (samples.length - 1)) * chartWidth;
      let speed = getSpeed(samples[i]);
      
      // If speed is below threshold, interpolate from last valid speed to next valid speed
      if (speed < MIN_SPEED_THRESHOLD && i > 0 && i < samples.length - 1) {
        // Find next valid speed
        let nextValidSpeed = lastValidSpeed ?? speed;
        for (let j = i + 1; j < samples.length; j++) {
          if (getSpeed(samples[j]) >= MIN_SPEED_THRESHOLD) {
            nextValidSpeed = getSpeed(samples[j]);
            break;
          }
        }
        // Interpolate between last valid and next valid
        if (lastValidSpeed !== null) {
          const progress = (i - lastValidIndex) / Math.max(1, samples.length - lastValidIndex);
          speed = lastValidSpeed + (nextValidSpeed - lastValidSpeed) * progress;
        } else {
          speed = nextValidSpeed;
        }
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

    // Draw extra fields (handles gaps for GGA-derived fields)
    enabledFields.forEach((field, fieldIndex) => {
      // Pre-calculate min/max for this field
      const values = samples
        .map(s => s.extraFields[field.name])
        .filter((v): v is number => v !== undefined);
      
      if (values.length === 0) return;
      
      const maxVal = Math.max(...values);
      const minVal = Math.min(...values);
      const range = maxVal - minVal || 1;
      
      ctx.beginPath();
      ctx.strokeStyle = COLORS[(fieldIndex + 1) % COLORS.length];
      ctx.lineWidth = 1.5;

      let isDrawing = false;
      
      for (let i = 0; i < samples.length; i++) {
        const val = samples[i].extraFields[field.name];
        
        // Handle gaps - if value is undefined, break the line
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
    const duration = samples[samples.length - 1].t / 1000; // seconds
    
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
      const boxX = Math.min(x + 10, dimensions.width - 120);
      const boxY = padding.top + 10;
      
      // Count fields with values at current index
      const fieldsWithValues = enabledFields.filter(f => 
        samples[currentIndex].extraFields[f.name] !== undefined
      );
      
      ctx.fillStyle = 'hsla(220, 18%, 10%, 0.9)';
      ctx.fillRect(boxX, boxY, 110, 20 + fieldsWithValues.length * 16);
      ctx.strokeStyle = 'hsl(220, 15%, 25%)';
      ctx.lineWidth = 1;
      ctx.strokeRect(boxX, boxY, 110, 20 + fieldsWithValues.length * 16);

      ctx.fillStyle = COLORS[0];
      ctx.textAlign = 'left';
      ctx.fillText(`Speed: ${currentSpeed.toFixed(1)} ${speedUnit.toLowerCase()}`, boxX + 8, boxY + 14);

      let fieldOffset = 1;
      enabledFields.forEach((field, idx) => {
        const val = samples[currentIndex].extraFields[field.name];
        if (val !== undefined) {
          ctx.fillStyle = COLORS[(idx + 1) % COLORS.length];
          ctx.fillText(`${field.name}: ${val.toFixed(1)}`, boxX + 8, boxY + 14 + fieldOffset * 16);
          fieldOffset++;
        }
      });
    }

  }, [samples, currentIndex, dimensions, enabledFields, useKph, speedUnit]);

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
    <div className="flex flex-col h-full bg-card">
      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[0] }} />
          <span className="text-xs font-mono">Speed ({speedUnit})</span>
        </div>
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
        className="flex-1 cursor-crosshair"
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
          style={{ width: dimensions.width, height: dimensions.height }}
          className="block"
        />
      </div>
    </div>
  );
}
