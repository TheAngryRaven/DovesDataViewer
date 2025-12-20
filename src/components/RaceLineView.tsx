import { useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import { GpsSample, Track } from '@/types/racing';
import 'leaflet/dist/leaflet.css';

interface RaceLineViewProps {
  samples: GpsSample[];
  referenceSamples?: GpsSample[];
  currentIndex: number;
  track: Track | null;
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
  useKph?: boolean;
}

// Get speed color (green -> yellow -> orange -> red)
function getSpeedColor(speedMph: number, maxSpeed: number): string {
  const ratio = Math.min(speedMph / Math.max(maxSpeed, 1), 1);
  
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

export function RaceLineView({ samples, referenceSamples = [], currentIndex, track, bounds, useKph = false }: RaceLineViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polylineLayerRef = useRef<L.LayerGroup | null>(null);
  const referenceLayerRef = useRef<L.LayerGroup | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const startFinishRef = useRef<L.Polyline | null>(null);

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

  // Calculate max speed for color scaling
  const maxSpeed = useMemo(() => {
    return Math.max(...samples.map(s => s.speedMph), 1);
  }, [samples]);

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

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      referenceLayerRef.current = null;
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
      const color = getSpeedColor(samples[i].speedMph, maxSpeed);
      const polyline = L.polyline(
        [[samples[i].lat, samples[i].lon], [samples[i + 1].lat, samples[i + 1].lon]],
        { color, weight: 4, opacity: 0.9 }
      );
      polylineLayer.addLayer(polyline);
    }
  }, [samples, referenceSamples, bounds, maxSpeed]);

  // Update start/finish line when track changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing start/finish line
    if (startFinishRef.current) {
      map.removeLayer(startFinishRef.current);
      startFinishRef.current = null;
    }

    if (!track) return;

    // Draw start/finish line
    startFinishRef.current = L.polyline(
      [[track.startFinishA.lat, track.startFinishA.lon], [track.startFinishB.lat, track.startFinishB.lon]],
      { color: 'hsl(0, 75%, 55%)', weight: 5, opacity: 1 }
    ).addTo(map);
  }, [track]);

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
      
      {/* Speed legend */}
      <div className="absolute top-4 right-4 bg-card/90 backdrop-blur-sm border border-border rounded p-2 z-[1000]">
        <div className="text-xs text-muted-foreground mb-1">Speed ({useKph ? 'kph' : 'mph'})</div>
        <div className="w-24 h-3 speed-gradient rounded" />
        <div className="flex justify-between text-xs text-muted-foreground mt-1 font-mono">
          <span>Slow</span>
          <span>Fast</span>
        </div>
      </div>
    </div>
  );
}
