import { useRef, useEffect, useState, useCallback } from 'react';
import { GpsSample, Track } from '@/types/racing';

interface RaceLineViewProps {
  samples: GpsSample[];
  currentIndex: number;
  track: Track | null;
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
}

export function RaceLineView({ samples, currentIndex, track, bounds }: RaceLineViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  
  // Pan and zoom state
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

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

  // Reset transform when data changes
  useEffect(() => {
    setTransform({ x: 0, y: 0, scale: 1 });
  }, [samples]);

  // Get speed color (green -> yellow -> orange -> red)
  const getSpeedColor = useCallback((speedMph: number, maxSpeed: number) => {
    const ratio = Math.min(speedMph / Math.max(maxSpeed, 1), 1);
    
    if (ratio < 0.33) {
      // Green to yellow
      const t = ratio / 0.33;
      const r = Math.round(76 + t * (230 - 76));
      const g = Math.round(175 + t * (180 - 175));
      const b = Math.round(80 - t * 80);
      return `rgb(${r},${g},${b})`;
    } else if (ratio < 0.66) {
      // Yellow to orange
      const t = (ratio - 0.33) / 0.33;
      const r = Math.round(230 + t * (240 - 230));
      const g = Math.round(180 - t * 80);
      const b = Math.round(0 + t * 50);
      return `rgb(${r},${g},${b})`;
    } else {
      // Orange to red
      const t = (ratio - 0.66) / 0.34;
      const r = Math.round(240 - t * 40);
      const g = Math.round(100 - t * 60);
      const b = Math.round(50 - t * 10);
      return `rgb(${r},${g},${b})`;
    }
  }, []);

  // Draw the race line
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0 || dimensions.height === 0) return;
    if (samples.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size with device pixel ratio for sharp rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.fillStyle = 'hsl(220, 20%, 6%)';
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    // Calculate projection - convert GPS to screen coordinates
    const padding = 40;
    
    // Get actual data range
    const latRange = bounds.maxLat - bounds.minLat;
    const lonRange = bounds.maxLon - bounds.minLon;
    
    // Ensure minimum range to avoid division issues
    const effectiveLatRange = Math.max(latRange, 0.0001);
    const effectiveLonRange = Math.max(lonRange, 0.0001);
    
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    
    // Apply latitude correction for longitude (mercator-like)
    const cosLat = Math.cos(centerLat * Math.PI / 180);
    
    // Convert to approximate meters for proper aspect ratio
    // 1 degree lat ≈ 111km, 1 degree lon ≈ 111km * cos(lat)
    const latMeters = effectiveLatRange * 111000;
    const lonMeters = effectiveLonRange * 111000 * cosLat;
    
    // Available drawing area
    const drawWidth = dimensions.width - padding * 2;
    const drawHeight = dimensions.height - padding * 2;
    
    // Scale to fit, maintaining aspect ratio
    const scaleToFit = Math.min(drawWidth / lonMeters, drawHeight / latMeters);
    
    // Project function: GPS -> screen coordinates
    const project = (lat: number, lon: number) => {
      // Convert to meters from center
      const dx = (lon - (bounds.minLon + bounds.maxLon) / 2) * 111000 * cosLat;
      const dy = (lat - (bounds.minLat + bounds.maxLat) / 2) * 111000;
      
      // Apply scale and center on screen
      const x = dimensions.width / 2 + dx * scaleToFit * transform.scale + transform.x;
      const y = dimensions.height / 2 - dy * scaleToFit * transform.scale + transform.y; // Y inverted for screen
      
      return { x, y };
    };

    // Find max speed for color scaling
    const maxSpeed = Math.max(...samples.map(s => s.speedMph), 1);

    // Draw the race line with speed gradient
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < samples.length - 1; i++) {
      const p1 = project(samples[i].lat, samples[i].lon);
      const p2 = project(samples[i + 1].lat, samples[i + 1].lon);
      
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = getSpeedColor(samples[i].speedMph, maxSpeed);
      ctx.stroke();
    }

    // Draw start/finish line if track is set
    if (track) {
      const sfA = project(track.startFinishA.lat, track.startFinishA.lon);
      const sfB = project(track.startFinishB.lat, track.startFinishB.lon);
      
      ctx.beginPath();
      ctx.moveTo(sfA.x, sfA.y);
      ctx.lineTo(sfB.x, sfB.y);
      ctx.strokeStyle = 'hsl(0, 75%, 55%)';
      ctx.lineWidth = 4;
      ctx.stroke();

      // Draw S/F label
      ctx.fillStyle = 'hsl(0, 75%, 55%)';
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.fillText('S/F', (sfA.x + sfB.x) / 2 - 10, (sfA.y + sfB.y) / 2 - 8);
    }

    // Draw current position marker
    if (currentIndex >= 0 && currentIndex < samples.length) {
      const current = samples[currentIndex];
      const pos = project(current.lat, current.lon);
      
      // Outer glow
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(34, 211, 238, 0.3)';
      ctx.fill();
      
      // Inner marker
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'hsl(180, 70%, 55%)';
      ctx.fill();
      ctx.strokeStyle = 'hsl(220, 20%, 6%)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

  }, [samples, currentIndex, track, bounds, dimensions, transform, getSpeedColor]);

  // Mouse handlers for pan
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      tx: transform.x,
      ty: transform.y
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setTransform(prev => ({
      ...prev,
      x: dragStart.current.tx + (e.clientX - dragStart.current.x),
      y: dragStart.current.ty + (e.clientY - dragStart.current.y)
    }));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(prev => ({
      ...prev,
      scale: Math.max(0.5, Math.min(10, prev.scale * delta))
    }));
  };

  // Touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      dragStart.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        tx: transform.x,
        ty: transform.y
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    setTransform(prev => ({
      ...prev,
      x: dragStart.current.tx + (e.touches[0].clientX - dragStart.current.x),
      y: dragStart.current.ty + (e.touches[0].clientY - dragStart.current.y)
    }));
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full relative bg-background cursor-grab active:cursor-grabbing"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <canvas
        ref={canvasRef}
        style={{ width: dimensions.width, height: dimensions.height }}
        className="block"
      />
      
      {/* Zoom controls */}
      <div className="absolute bottom-4 left-4 flex flex-col gap-1">
        <button
          onClick={() => setTransform(prev => ({ ...prev, scale: prev.scale * 1.2 }))}
          className="w-8 h-8 bg-card border border-border rounded flex items-center justify-center text-foreground hover:bg-muted transition-colors"
        >
          +
        </button>
        <button
          onClick={() => setTransform(prev => ({ ...prev, scale: prev.scale / 1.2 }))}
          className="w-8 h-8 bg-card border border-border rounded flex items-center justify-center text-foreground hover:bg-muted transition-colors"
        >
          −
        </button>
      </div>

      {/* Speed legend */}
      <div className="absolute top-4 right-4 bg-card/80 backdrop-blur-sm border border-border rounded p-2">
        <div className="text-xs text-muted-foreground mb-1">Speed</div>
        <div className="w-24 h-3 speed-gradient rounded" />
        <div className="flex justify-between text-xs text-muted-foreground mt-1 font-mono">
          <span>Slow</span>
          <span>Fast</span>
        </div>
      </div>
    </div>
  );
}
