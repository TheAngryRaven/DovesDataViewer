import { useEffect, useRef, useMemo, useState } from 'react';
import L from 'leaflet';
import { GpsSample, Course } from '@/types/racing';
import { findSpeedEvents, SpeedEvent } from '@/lib/speedEvents';
import { computeHeatmapSpeedBoundsMph } from '@/lib/speedBounds';
import { detectBrakingZones, BrakingZoneConfig } from '@/lib/brakingZones';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { Moon, Satellite, Square, WifiOff, Zap, Octagon, Map as MapIcon } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

type MapStyle = 'dark' | 'satellite' | 'none';

const mapStyleConfig = {
  dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '&copy; CARTO' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '&copy; Esri' },
  none: null,
};

function getSpeedColor(speedMph: number, minSpeed: number, maxSpeed: number): string {
  const range = maxSpeed - minSpeed;
  const ratio = range > 0 ? Math.min(Math.max((speedMph - minSpeed) / range, 0), 1) : 0.5;
  if (ratio < 0.33) { const t = ratio / 0.33; return `rgb(${Math.round(76 + t * 154)},${Math.round(175 + t * 5)},${Math.round(80 - t * 80)})`; }
  else if (ratio < 0.66) { const t = (ratio - 0.33) / 0.33; return `rgb(${Math.round(230 + t * 10)},${Math.round(180 - t * 80)},${Math.round(t * 50)})`; }
  else { const t = (ratio - 0.66) / 0.34; return `rgb(${Math.round(240 - t * 40)},${Math.round(100 - t * 60)},${Math.round(50 - t * 10)})`; }
}

function createArrowIcon(heading: number): L.DivIcon {
  return L.divIcon({
    html: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(${heading}deg);transform-origin:center;"><polygon points="10,2 18,18 10,14 2,18" fill="hsl(180,70%,55%)" stroke="hsl(220,20%,10%)" stroke-width="1.5"/></svg>`,
    className: 'arrow-marker', iconSize: [20, 20], iconAnchor: [10, 10],
  });
}

function createSpeedEventIcon(event: SpeedEvent, useKph: boolean): L.DivIcon {
  const displaySpeed = useKph ? (event.speed * 1.60934).toFixed(1) : event.speed.toFixed(1);
  const bg = event.type === 'peak' ? 'hsl(142,76%,36%)' : 'hsl(0,84%,50%)';
  return L.divIcon({
    html: `<div style="background:${bg};color:white;font-size:10px;font-weight:600;font-family:ui-monospace,monospace;padding:2px 5px;border-radius:4px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.3)">${displaySpeed}</div>`,
    className: 'speed-event-marker', iconSize: [30, 18], iconAnchor: [15, 20],
  });
}

interface MiniMapProps {
  samples: GpsSample[];
  allSamples: GpsSample[];
  currentIndex: number;
  course: Course | null;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

export function MiniMap({ samples, allSamples, currentIndex, course, bounds }: MiniMapProps) {
  const { useKph, brakingZoneSettings } = useSettingsContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polylineLayerRef = useRef<L.LayerGroup | null>(null);
  const brakingZonesLayerRef = useRef<L.LayerGroup | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const speedEventsLayerRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  const [showSpeedEvents, setShowSpeedEvents] = useState(true);
  const [showBrakingZones, setShowBrakingZones] = useState(true);
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');
  const isOnline = useOnlineStatus();

  const { minSpeed, maxSpeed } = useMemo(() => {
    const speeds = allSamples.map(s => s.speedMph);
    return computeHeatmapSpeedBoundsMph(speeds);
  }, [allSamples]);

  const speedEventsForMarkers = useMemo(() => {
    if (samples.length < 10) return [];
    return findSpeedEvents(samples, { smoothingWindow: 5, minSwing: 3, minSeparationMs: 1000, debounceCount: 2 });
  }, [samples]);

  const brakingZones = useMemo(() => {
    if (samples.length < 10) return [];
    const config: BrakingZoneConfig = brakingZoneSettings
      ? { entryThresholdG: -brakingZoneSettings.entryThresholdG, exitThresholdG: -brakingZoneSettings.exitThresholdG, minDurationMs: brakingZoneSettings.minDurationMs, smoothingAlpha: brakingZoneSettings.smoothingAlpha }
      : undefined as any;
    return detectBrakingZones(samples, config);
  }, [samples, brakingZoneSettings]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => { mapRef.current?.invalidateSize(); });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: false }).setView([0, 0], 16);
    const config = mapStyleConfig.dark;
    if (config) tileLayerRef.current = L.tileLayer(config.url, { attribution: config.attribution, maxZoom: 21 }).addTo(map);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    brakingZonesLayerRef.current = L.layerGroup().addTo(map);
    polylineLayerRef.current = L.layerGroup().addTo(map);
    speedEventsLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Tile layer
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (tileLayerRef.current) { map.removeLayer(tileLayerRef.current); tileLayerRef.current = null; }
    const config = mapStyleConfig[mapStyle];
    if (config) { tileLayerRef.current = L.tileLayer(config.url, { attribution: config.attribution, maxZoom: 21 }).addTo(map); tileLayerRef.current.bringToBack(); }
  }, [mapStyle]);

  // Draw race line
  useEffect(() => {
    const map = mapRef.current; const pl = polylineLayerRef.current; if (!map || !pl) return;
    pl.clearLayers();
    if (samples.length === 0) return;
    map.fitBounds(L.latLngBounds([[bounds.minLat, bounds.minLon], [bounds.maxLat, bounds.maxLon]]), { padding: [10, 10] });
    for (let i = 0; i < samples.length - 1; i++) {
      const color = getSpeedColor(samples[i].speedMph, minSpeed, maxSpeed);
      pl.addLayer(L.polyline([[samples[i].lat, samples[i].lon], [samples[i + 1].lat, samples[i + 1].lon]], { color, weight: 3, opacity: 0.9 }));
    }
  }, [samples, bounds, minSpeed, maxSpeed]);

  // Speed events
  useEffect(() => {
    const layer = speedEventsLayerRef.current; if (!layer) return;
    layer.clearLayers();
    if (!showSpeedEvents) return;
    speedEventsForMarkers.forEach(ev => {
      layer.addLayer(L.marker([ev.lat, ev.lon], { icon: createSpeedEventIcon(ev, useKph), interactive: false }));
    });
  }, [speedEventsForMarkers, showSpeedEvents, useKph]);

  // Braking zones
  useEffect(() => {
    const layer = brakingZonesLayerRef.current; if (!layer) return;
    layer.clearLayers();
    if (!showBrakingZones || brakingZones.length === 0) return;
    const zoneColor = brakingZoneSettings?.color ?? 'hsl(210, 90%, 55%)';
    const zoneWidth = brakingZoneSettings?.width ?? 10;
    brakingZones.forEach(zone => {
      layer.addLayer(L.polyline(zone.path.map(p => [p.lat, p.lon] as [number, number]), {
        color: zoneColor, weight: zoneWidth, opacity: 0.85, lineCap: 'round', lineJoin: 'round',
      }));
    });
  }, [brakingZones, showBrakingZones, brakingZoneSettings?.color, brakingZoneSettings?.width]);

  // Arrow marker
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (markerRef.current) { map.removeLayer(markerRef.current); markerRef.current = null; }
    if (currentIndex < 0 || currentIndex >= samples.length) return;
    const sample = samples[currentIndex];
    let heading = sample.heading ?? 0;
    if (heading === 0 && currentIndex > 0) {
      const prev = samples[currentIndex - 1];
      const dLat = sample.lat - prev.lat, dLon = sample.lon - prev.lon;
      if (Math.abs(dLat) > 0.00001 || Math.abs(dLon) > 0.00001) heading = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
    }
    markerRef.current = L.marker([sample.lat, sample.lon], { icon: createArrowIcon(heading) }).addTo(map);
    map.panTo([sample.lat, sample.lon], { animate: true, duration: 0.15 });
  }, [currentIndex, samples]);

  const cycleMapStyle = () => setMapStyle(p => p === 'dark' ? 'satellite' : p === 'satellite' ? 'none' : 'dark');
  const mapStyleIcon = { dark: <Moon className="w-3 h-3" />, satellite: <Satellite className="w-3 h-3" />, none: <Square className="w-3 h-3" /> };

  return (
    <div className="h-full relative">
      <div ref={containerRef} className="w-full h-full bg-black" />

      {/* Map style toggle - upper left */}
      <button
        onClick={cycleMapStyle}
        className="absolute top-2 left-2 z-[1000] p-1.5 rounded bg-card/90 backdrop-blur-sm border border-border hover:bg-muted/50 text-muted-foreground"
        title={`Map: ${mapStyle}`}
      >
        {mapStyleIcon[mapStyle]}
      </button>

      {/* Event toggles - upper right */}
      <div className="absolute top-2 right-2 z-[1000] flex gap-1">
        <button
          onClick={() => setShowBrakingZones(!showBrakingZones)}
          className={`p-1.5 rounded bg-card/90 backdrop-blur-sm border border-border hover:bg-muted/50 transition-colors ${showBrakingZones ? 'text-primary' : 'text-muted-foreground'}`}
          title="Braking zones"
        >
          <Octagon className="w-3 h-3" />
        </button>
        <button
          onClick={() => setShowSpeedEvents(!showSpeedEvents)}
          className={`p-1.5 rounded bg-card/90 backdrop-blur-sm border border-border hover:bg-muted/50 transition-colors ${showSpeedEvents ? 'text-primary' : 'text-muted-foreground'}`}
          title="Speed events"
        >
          <Zap className="w-3 h-3" />
        </button>
      </div>

      {!isOnline && (
        <div className="absolute bottom-2 left-2 z-[1000] flex items-center gap-1 text-xs text-amber-500">
          <WifiOff className="w-3 h-3" /> offline
        </div>
      )}
    </div>
  );
}
