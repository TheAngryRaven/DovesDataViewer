import { useEffect, useRef, useMemo, useState } from 'react';
import L from 'leaflet';
import { GpsSample, Course, courseHasSectors } from '@/types/racing';
import { findSpeedEvents, SpeedEvent } from '@/lib/speedEvents';
import { computeHeatmapSpeedBoundsMph } from '@/lib/speedBounds';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import 'leaflet/dist/leaflet.css';

interface RaceLineViewProps {
  samples: GpsSample[];
  allSamples?: GpsSample[]; // Full session samples for computing stats (not affected by range slider)
  referenceSamples?: GpsSample[];
  currentIndex: number;
  course: Course | null;
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
  useKph?: boolean;
  paceDiff?: number | null;
  paceDiffLabel?: 'best' | 'ref';
  deltaTopSpeed?: number | null;
  deltaMinSpeed?: number | null;
  referenceLapNumber?: number | null;
}

// Get speed color (green -> yellow -> orange -> red)
function getSpeedColor(speedMph: number, minSpeed: number, maxSpeed: number): string {
  const range = maxSpeed - minSpeed;
  const ratio = range > 0 ? Math.min(Math.max((speedMph - minSpeed) / range, 0), 1) : 0.5;
  
  if (ratio < 0.33) {
    const t = ratio / 0.33;
    const r = Math.round(76 + t * (230 - 76));
    const g = Math.round(175 + t * (180 - 175));
    const b = Math.round(80 - t * 80);
    return `rgb(${r},${g},${b})`;
  } else if (ratio < 0.66) {
    const t = (ratio - 0.33) / 0.33;
    const r = Math.round(230 + t * (240 - 230));
    const g = Math.round(180 - t * 80);
    const b = Math.round(0 + t * 50);
    return `rgb(${r},${g},${b})`;
  } else {
    const t = (ratio - 0.66) / 0.34;
    const r = Math.round(240 - t * 40);
    const g = Math.round(100 - t * 60);
    const b = Math.round(50 - t * 10);
    return `rgb(${r},${g},${b})`;
  }
}

// Create SVG triangle/arrow marker pointing up (0 degrees)
function createArrowIcon(heading: number): L.DivIcon {
  // SVG arrow pointing up, we rotate it via CSS
  const svg = `
    <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" 
         style="transform: rotate(${heading}deg); transform-origin: center;">
      <polygon 
        points="10,2 18,18 10,14 2,18" 
        fill="hsl(180, 70%, 55%)" 
        stroke="hsl(220, 20%, 10%)" 
        stroke-width="1.5"
      />
    </svg>
  `;
  
  return L.divIcon({
    html: svg,
    className: 'arrow-marker',
    iconSize: [20, 20],
    iconAnchor: [10, 10], // Center of the icon
  });
}

// Create speed event marker (peak or valley)
function createSpeedEventIcon(event: SpeedEvent, useKph: boolean): L.DivIcon {
  const displaySpeed = useKph ? (event.speed * 1.60934).toFixed(1) : event.speed.toFixed(1);
  const isPeak = event.type === 'peak';
  const bgColor = isPeak ? 'hsl(142, 76%, 36%)' : 'hsl(0, 84%, 50%)';
  const textColor = 'white';
  
  const html = `
    <div style="
      background: ${bgColor};
      color: ${textColor};
      font-size: 10px;
      font-weight: 600;
      font-family: ui-monospace, monospace;
      padding: 2px 5px;
      border-radius: 4px;
      white-space: nowrap;
      box-shadow: 0 1px 3px rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.3);
    ">${displaySpeed}</div>
  `;
  
  return L.divIcon({
    html,
    className: 'speed-event-marker',
    iconSize: [30, 18],
    iconAnchor: [15, 20], // Anchor below the point
  });
}

export function RaceLineView({ samples, allSamples, referenceSamples = [], currentIndex, course, bounds, useKph = false, paceDiff = null, paceDiffLabel = 'best', deltaTopSpeed = null, deltaMinSpeed = null, referenceLapNumber = null }: RaceLineViewProps) {
  // Use allSamples for statistics if provided, otherwise fall back to samples
  const samplesForStats = allSamples ?? samples;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polylineLayerRef = useRef<L.LayerGroup | null>(null);
  const referenceLayerRef = useRef<L.LayerGroup | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const startFinishRef = useRef<L.Polyline | null>(null);
  const sector2Ref = useRef<L.Polyline | null>(null);
  const sector3Ref = useRef<L.Polyline | null>(null);
  const speedEventsLayerRef = useRef<L.LayerGroup | null>(null);
  
  const [showSpeedEvents, setShowSpeedEvents] = useState(true);

  // Compute speed events from full session samples for stable stats
  const speedEventsForStats = useMemo(() => {
    if (samplesForStats.length < 10) return [];
    return findSpeedEvents(samplesForStats, {
      smoothingWindow: 5,
      minSwing: 3,
      minSeparationMs: 1000,
      debounceCount: 2,
    });
  }, [samplesForStats]);

  // Compute speed events from visible samples for map markers
  const speedEventsForMarkers = useMemo(() => {
    if (samples.length < 10) return [];
    return findSpeedEvents(samples, {
      smoothingWindow: 5,
      minSwing: 3,
      minSeparationMs: 1000,
      debounceCount: 2,
    });
  }, [samples]);

  // Invalidate map size when container resizes
  useEffect(() => {
    const container = containerRef.current;
    const map = mapRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Calculate min and max speed for color scaling from full session (exclude brief 0mph glitches)
  const { minSpeed, maxSpeed } = useMemo(() => {
    const speedsMph = samplesForStats.map((s) => s.speedMph);
    return computeHeatmapSpeedBoundsMph(speedsMph);
  }, [samplesForStats]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([0, 0], 16);

    // Dark map tiles from CARTO
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 20,
    }).addTo(map);

    // Add zoom control to bottom left
    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    // Create layer group for reference polylines (rendered underneath)
    referenceLayerRef.current = L.layerGroup().addTo(map);

    // Create layer group for current lap polylines
    polylineLayerRef.current = L.layerGroup().addTo(map);
    
    // Create layer group for speed event markers (on top)
    speedEventsLayerRef.current = L.layerGroup().addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      referenceLayerRef.current = null;
      speedEventsLayerRef.current = null;
    };
  }, []);

  // Update bounds and race line when samples change
  useEffect(() => {
    const map = mapRef.current;
    const polylineLayer = polylineLayerRef.current;
    const referenceLayer = referenceLayerRef.current;
    if (!map || !polylineLayer || !referenceLayer) return;

    // Clear existing polylines
    polylineLayer.clearLayers();
    referenceLayer.clearLayers();

    if (samples.length === 0) return;

    // Fit bounds
    const latLngBounds = L.latLngBounds([
      [bounds.minLat, bounds.minLon],
      [bounds.maxLat, bounds.maxLon]
    ]);
    map.fitBounds(latLngBounds, { padding: [20, 20] });

    // Draw reference line first (underneath) as grey
    if (referenceSamples.length > 0) {
      const refCoords = referenceSamples.map(s => [s.lat, s.lon] as [number, number]);
      const refPolyline = L.polyline(refCoords, { 
        color: 'hsl(220, 10%, 50%)', 
        weight: 4, 
        opacity: 0.6 
      });
      referenceLayer.addLayer(refPolyline);
    }

    // Draw race line segments with speed coloring
    for (let i = 0; i < samples.length - 1; i++) {
      const color = getSpeedColor(samples[i].speedMph, minSpeed, maxSpeed);
      const polyline = L.polyline(
        [[samples[i].lat, samples[i].lon], [samples[i + 1].lat, samples[i + 1].lon]],
        { color, weight: 4, opacity: 0.9 }
      );
      polylineLayer.addLayer(polyline);
    }
  }, [samples, referenceSamples, bounds, minSpeed, maxSpeed]);

  // Update speed event markers
  useEffect(() => {
    const map = mapRef.current;
    const speedEventsLayer = speedEventsLayerRef.current;
    if (!map || !speedEventsLayer) return;

    speedEventsLayer.clearLayers();

    if (!showSpeedEvents || speedEventsForMarkers.length === 0) return;

    speedEventsForMarkers.forEach((event) => {
      const marker = L.marker([event.lat, event.lon], {
        icon: createSpeedEventIcon(event, useKph),
        interactive: false,
      });
      speedEventsLayer.addLayer(marker);
    });
  }, [speedEventsForMarkers, showSpeedEvents, useKph]);

  // Update start/finish line and sector lines when course changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing timing lines
    if (startFinishRef.current) {
      map.removeLayer(startFinishRef.current);
      startFinishRef.current = null;
    }
    if (sector2Ref.current) {
      map.removeLayer(sector2Ref.current);
      sector2Ref.current = null;
    }
    if (sector3Ref.current) {
      map.removeLayer(sector3Ref.current);
      sector3Ref.current = null;
    }

    if (!course) return;

    // Draw start/finish line (red)
    startFinishRef.current = L.polyline(
      [[course.startFinishA.lat, course.startFinishA.lon], [course.startFinishB.lat, course.startFinishB.lon]],
      { color: 'hsl(0, 75%, 55%)', weight: 5, opacity: 1 }
    ).addTo(map);

    // Draw sector lines if they exist (purple/magenta)
    if (courseHasSectors(course) && course.sector2 && course.sector3) {
      sector2Ref.current = L.polyline(
        [[course.sector2.a.lat, course.sector2.a.lon], [course.sector2.b.lat, course.sector2.b.lon]],
        { color: 'hsl(280, 70%, 55%)', weight: 4, opacity: 0.9 }
      ).addTo(map);

      sector3Ref.current = L.polyline(
        [[course.sector3.a.lat, course.sector3.a.lon], [course.sector3.b.lat, course.sector3.b.lon]],
        { color: 'hsl(280, 70%, 55%)', weight: 4, opacity: 0.9 }
      ).addTo(map);
    }
  }, [course]);

  // Update current position marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing marker
    if (markerRef.current) {
      map.removeLayer(markerRef.current);
      markerRef.current = null;
    }

    if (currentIndex < 0 || currentIndex >= samples.length) return;

    const sample = samples[currentIndex];
    
    // Get heading - use the sample's heading, or calculate from previous sample
    let heading = sample.heading ?? 0;
    
    // If no heading data, try to calculate from movement direction
    if (heading === 0 && currentIndex > 0) {
      const prevSample = samples[currentIndex - 1];
      const dLat = sample.lat - prevSample.lat;
      const dLon = sample.lon - prevSample.lon;
      if (Math.abs(dLat) > 0.00001 || Math.abs(dLon) > 0.00001) {
        heading = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
      }
    }
    
    // Create arrow marker with heading
    markerRef.current = L.marker([sample.lat, sample.lon], {
      icon: createArrowIcon(heading),
    }).addTo(map);
  }, [currentIndex, samples]);

  if (samples.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-background text-muted-foreground">
        No GPS data loaded
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full" />
      
      {/* Speed events toggle */}
      <div className="absolute top-4 left-4 bg-card/90 backdrop-blur-sm border border-border rounded p-2 z-[1000]">
        <div className="flex items-center gap-2">
          <Switch 
            id="speed-events" 
            checked={showSpeedEvents} 
            onCheckedChange={setShowSpeedEvents}
            className="scale-75"
          />
          <Label htmlFor="speed-events" className="text-xs text-muted-foreground cursor-pointer">
            Speed events
          </Label>
        </div>
        {showSpeedEvents && speedEventsForMarkers.length > 0 && (
          <div className="flex items-center gap-3 mt-2 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(142, 76%, 36%)' }} />
              <span className="text-muted-foreground">Peak</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(0, 84%, 50%)' }} />
              <span className="text-muted-foreground">Valley</span>
            </div>
          </div>
        )}
      </div>
      
      {/* Speed legend */}
      <div className="absolute top-4 right-4 bg-card/90 backdrop-blur-sm border border-border rounded p-2 z-[1000] min-w-[120px]">
        <div className="text-xs text-muted-foreground mb-1">Speed ({useKph ? 'kph' : 'mph'})</div>
        <div className="w-full h-3 speed-gradient rounded" />
        <div className="flex justify-between text-xs text-muted-foreground mt-1 font-mono">
          <span>{useKph ? (minSpeed * 1.60934).toFixed(0) : minSpeed.toFixed(0)}</span>
          <span>{useKph ? (maxSpeed * 1.60934).toFixed(0) : maxSpeed.toFixed(0)}</span>
        </div>
        
        {/* Average speed stats from speed events - only show when course is selected */}
        {course && speedEventsForStats.length > 0 && (() => {
          const peaks = speedEventsForStats.filter(e => e.type === 'peak');
          const valleys = speedEventsForStats.filter(e => e.type === 'valley');
          const avgTop = peaks.length > 0 
            ? peaks.reduce((sum, e) => sum + e.speed, 0) / peaks.length 
            : null;
          const avgMin = valleys.length > 0 
            ? valleys.reduce((sum, e) => sum + e.speed, 0) / valleys.length 
            : null;
          const unit = useKph ? 'kph' : 'mph';
          const convertSpeed = (speed: number) => useKph ? speed * 1.60934 : speed;
          
          return (
            <div className="mt-3 pt-2 border-t border-border space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Avg Top Speed:</span>
                <span className="font-mono" style={{ color: 'hsl(142, 76%, 45%)' }}>
                  {avgTop !== null ? `${convertSpeed(avgTop).toFixed(1)} ${unit}` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Avg Min Speed:</span>
                <span className="font-mono" style={{ color: 'hsl(0, 84%, 55%)' }}>
                  {avgMin !== null ? `${convertSpeed(avgMin).toFixed(1)} ${unit}` : '—'}
                </span>
              </div>
              
              {/* Delta section */}
              {(referenceLapNumber !== null || paceDiff !== null || deltaTopSpeed !== null || deltaMinSpeed !== null) && (
                <div className="mt-2 pt-2 border-t border-border space-y-1">
                  <div className="text-xs text-muted-foreground mb-1 text-center">
                    Δ {paceDiffLabel}
                  </div>
                  {referenceLapNumber !== null && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Δ Lap</span>
                      <span className="font-mono text-foreground">{referenceLapNumber}</span>
                    </div>
                  )}
                  {paceDiff !== null && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Δ Time:</span>
                      <span 
                        className="font-mono"
                        style={{ color: paceDiff < 0 ? 'hsl(142, 76%, 45%)' : paceDiff > 0 ? 'hsl(0, 84%, 55%)' : 'hsl(var(--muted-foreground))' }}
                      >
                        {paceDiff > 0 ? '+' : ''}{paceDiff.toFixed(2)}s
                      </span>
                    </div>
                  )}
                  {deltaTopSpeed !== null && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Δ Top Speed:</span>
                      <span 
                        className="font-mono"
                        style={{ color: deltaTopSpeed > 0 ? 'hsl(142, 76%, 45%)' : deltaTopSpeed < 0 ? 'hsl(0, 84%, 55%)' : 'hsl(var(--muted-foreground))' }}
                      >
                        {deltaTopSpeed > 0 ? '+' : ''}{convertSpeed(deltaTopSpeed).toFixed(1)} {unit}
                      </span>
                    </div>
                  )}
                  {deltaMinSpeed !== null && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Δ Min Speed:</span>
                      <span 
                        className="font-mono"
                        style={{ color: deltaMinSpeed > 0 ? 'hsl(142, 76%, 45%)' : deltaMinSpeed < 0 ? 'hsl(0, 84%, 55%)' : 'hsl(var(--muted-foreground))' }}
                      >
                        {deltaMinSpeed > 0 ? '+' : ''}{convertSpeed(deltaMinSpeed).toFixed(1)} {unit}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
