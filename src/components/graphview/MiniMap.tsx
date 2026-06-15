import { useEffect, useRef, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import { GpsSample, Course } from '@/types/racing';
import { findSpeedEvents, SpeedEvent } from '@/lib/speedEvents';
import { computeHeatmapSpeedBoundsMph } from '@/lib/speedBounds';
import { buildHeatmapSegments } from '@/lib/speedHeatmap';
import { detectBrakingZones, BrakingZoneConfig } from '@/lib/brakingZones';
import { unionBounds, cropOverlayLinesToWindow, type OverlayLine } from '@/lib/lapOverlays';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { updatePositionMarker, ARROW_MARKER_SIZE } from '@/components/map/positionArrowMarker';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { usePlaybackContext } from '@/contexts/PlaybackContext';
import { Moon, Satellite, Square, WifiOff, Zap, Octagon, Map as MapIcon, X, Crosshair, List, ChevronDown, ChevronUp } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

type MapStyle = 'dark' | 'satellite' | 'none';

const NO_OVERLAY_LINES: OverlayLine[] = [];

const mapStyleConfig = {
  dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '&copy; CARTO' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '&copy; Esri' },
  none: null,
};

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
  referenceSamples?: GpsSample[];
  course: Course | null;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  isAllLaps?: boolean;
  /** Extra racing lines (other laps / snapshots) to overlay. */
  overlayLines?: OverlayLine[];
  /** Visible-range start index into `allSamples` — crops overlays to the playback window. */
  rangeStart?: number;
  /** Remove an overlay by id (legend ✕). */
  onRemoveOverlay?: (id: string) => void;
  /** Whether cross-session overlays are drift-aligned onto the current lap. */
  alignOverlays?: boolean;
  onToggleAlignOverlays?: () => void;
  /** Expand the overlay legend (per-lap list). Racing lines stay drawn when collapsed. */
  showOverlayLegend?: boolean;
  onToggleOverlayLegend?: () => void;
}

export function MiniMap({ samples, allSamples, referenceSamples = [], course, bounds, isAllLaps, overlayLines = [], rangeStart = 0, onRemoveOverlay, alignOverlays, onToggleAlignOverlays, showOverlayLegend = true, onToggleOverlayLegend }: MiniMapProps) {
  const { t } = useTranslation('session');
  const { useKph, brakingZoneSettings } = useSettingsContext();
  const { currentIndex } = usePlaybackContext();

  // Crop overlay racing lines to the same playback window as the active lap, so
  // cropping the range shrinks them on the map exactly like the heatmap line
  // (`samples` is the cropped window; `allSamples` is the full current lap).
  // Stable empty reference when no overlays — the fitBounds effect keys on this,
  // and a fresh [] per range tick would re-fit the map on every slider movement.
  const drawnOverlayLines = useMemo(
    () => (overlayLines.length === 0
      ? NO_OVERLAY_LINES
      : cropOverlayLinesToWindow(overlayLines, allSamples, rangeStart, rangeStart + samples.length - 1)),
    [overlayLines, allSamples, rangeStart, samples.length],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polylineLayerRef = useRef<L.LayerGroup | null>(null);
  const referenceLayerRef = useRef<L.LayerGroup | null>(null);
  const brakingZonesLayerRef = useRef<L.LayerGroup | null>(null);
  const overlayLinesLayerRef = useRef<L.LayerGroup | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const speedEventsLayerRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  const [showSpeedEvents, setShowSpeedEvents] = useState(true);
  const [showBrakingZones, setShowBrakingZones] = useState(true);

  // Auto-toggle overlays based on All Laps mode
  useEffect(() => {
    if (isAllLaps) {
      setShowSpeedEvents(false);
      setShowBrakingZones(false);
    } else {
      setShowSpeedEvents(true);
      setShowBrakingZones(true);
    }
  }, [isAllLaps]);
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
    if (!brakingZoneSettings) {
      return detectBrakingZones(samples); // fall back to DEFAULT_BRAKING_CONFIG
    }
    const config: BrakingZoneConfig = {
      entryThresholdG: -brakingZoneSettings.entryThresholdG,
      exitThresholdG: -brakingZoneSettings.exitThresholdG,
      minDurationMs: brakingZoneSettings.minDurationMs,
      smoothingAlpha: brakingZoneSettings.smoothingAlpha,
    };
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

  // Init map (canvas renderer: vector layers share one <canvas> instead of one
  // SVG DOM node per layer)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: false, preferCanvas: true }).setView([0, 0], 16);
    const config = mapStyleConfig.dark;
    if (config) tileLayerRef.current = L.tileLayer(config.url, { attribution: config.attribution, maxZoom: 21 }).addTo(map);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    referenceLayerRef.current = L.layerGroup().addTo(map);
    brakingZonesLayerRef.current = L.layerGroup().addTo(map);
    overlayLinesLayerRef.current = L.layerGroup().addTo(map);
    polylineLayerRef.current = L.layerGroup().addTo(map);
    speedEventsLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
  }, []);

  // Tile layer
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (tileLayerRef.current) { map.removeLayer(tileLayerRef.current); tileLayerRef.current = null; }
    const config = mapStyleConfig[mapStyle];
    if (config) { tileLayerRef.current = L.tileLayer(config.url, { attribution: config.attribution, maxZoom: 21 }).addTo(map); tileLayerRef.current.bringToBack(); }
  }, [mapStyle]);

  // Fit the view — its own effect so a range-slider drag (which rebuilds the
  // heatmap) doesn't re-fit the map on every movement. Fits to the active lap
  // plus any overlays (a cross-session snapshot can run slightly outside).
  const hasSamples = samples.length > 0;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasSamples) return;
    const fit = unionBounds(bounds, drawnOverlayLines);
    map.fitBounds(L.latLngBounds([[fit.minLat, fit.minLon], [fit.maxLat, fit.maxLon]]), { padding: [10, 10] });
  }, [bounds, drawnOverlayLines, hasSamples]);

  // Draw reference line underneath as grey
  useEffect(() => {
    const rl = referenceLayerRef.current; if (!rl) return;
    rl.clearLayers();
    if (referenceSamples.length === 0) return;
    const refCoords = referenceSamples.map(s => [s.lat, s.lon] as [number, number]);
    rl.addLayer(L.polyline(refCoords, { color: 'hsl(220, 10%, 50%)', weight: 4, opacity: 0.6, interactive: false }));
  }, [referenceSamples]);

  // Speed-colored race line: one multi-part polyline per color bucket (~20
  // canvas layers) instead of one layer per GPS segment.
  useEffect(() => {
    const pl = polylineLayerRef.current; if (!pl) return;
    pl.clearLayers();
    for (const bucket of buildHeatmapSegments(samples, minSpeed, maxSpeed)) {
      pl.addLayer(L.polyline(bucket.parts, { color: bucket.color, weight: 3, opacity: 0.9, interactive: false }));
    }
  }, [samples, minSpeed, maxSpeed]);

  // Overlay racing lines (other laps / snapshots) — solid distinct colors, drawn
  // beneath the active heatmap. Rebuilt only when the overlay set changes.
  useEffect(() => {
    const layer = overlayLinesLayerRef.current; if (!layer) return;
    layer.clearLayers();
    for (const line of drawnOverlayLines) {
      const coords = line.samples.map(s => [s.lat, s.lon] as [number, number]);
      layer.addLayer(L.polyline(coords, { color: line.color, weight: 3, opacity: 0.7 }));
    }
  }, [drawnOverlayLines]);

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

  // Arrow marker (created once, moved/rotated per tick) + follow-pan.
  // Re-center only once the arrow's edge actually touches the viewport border
  // (margin = the marker's half-extent), not when it leaves some inner box — so
  // the camera holds steady while the cursor crosses most of the map and snaps
  // only at the true edge. Re-centering puts the arrow back at dead-center, so
  // it has the full half-width to travel before the next snap (no oscillation).
  // panTo is un-animated — an animated panTo issued per 16 ms tick perpetually
  // interrupts itself and burns the frame budget on aborted pan animations.
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    markerRef.current = updatePositionMarker(map, markerRef.current, samples, currentIndex);
    const sample = samples[currentIndex];
    if (!sample) return;
    const p = map.latLngToContainerPoint([sample.lat, sample.lon]);
    const size = map.getSize();
    const margin = ARROW_MARKER_SIZE / 2;
    if (p.x < margin || p.x > size.x - margin || p.y < margin || p.y > size.y - margin) {
      map.panTo([sample.lat, sample.lon], { animate: false });
    }
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
        title={`${t('map.mapPrefix')}: ${mapStyle === 'dark' ? t('map.styleDark') : mapStyle === 'satellite' ? t('map.styleSatellite') : t('map.styleNone')}`}
      >
        {mapStyleIcon[mapStyle]}
      </button>

      {/* Event toggles - upper right */}
      <div className="absolute top-2 right-2 z-[1000] flex gap-1">
        <button
          onClick={() => setShowBrakingZones(!showBrakingZones)}
          className={`p-1.5 rounded bg-card/90 backdrop-blur-sm border border-border hover:bg-muted/50 transition-colors ${showBrakingZones ? 'text-primary' : 'text-muted-foreground'}`}
          title={t('map.brakingZones')}
        >
          <Octagon className="w-3 h-3" />
        </button>
        <button
          onClick={() => setShowSpeedEvents(!showSpeedEvents)}
          className={`p-1.5 rounded bg-card/90 backdrop-blur-sm border border-border hover:bg-muted/50 transition-colors ${showSpeedEvents ? 'text-primary' : 'text-muted-foreground'}`}
          title={t('map.speedEvents')}
        >
          <Zap className="w-3 h-3" />
        </button>
      </div>

      {/* Overlay legend - lower right */}
      {overlayLines.length > 0 && (
        <div className="absolute bottom-2 right-2 z-[1000] max-w-[55%] max-h-[40%] overflow-y-auto rounded bg-card/90 backdrop-blur-sm border border-border p-1.5 space-y-1 scrollbar-thin">
          {onToggleOverlayLegend && (
            <button
              onClick={onToggleOverlayLegend}
              className={`flex w-full items-center gap-1.5 text-[11px] font-mono ${showOverlayLegend ? 'text-primary' : 'text-muted-foreground'}`}
              title={showOverlayLegend ? t('map.overlaysCollapseTitle') : t('map.overlaysShowTitle', { count: overlayLines.length })}
            >
              <List className="w-3 h-3 shrink-0" />
              <span>{showOverlayLegend ? t('map.overlays') : t('map.overlayCount', { count: overlayLines.length })}</span>
              {showOverlayLegend ? <ChevronDown className="w-3 h-3 shrink-0 ml-auto" /> : <ChevronUp className="w-3 h-3 shrink-0 ml-auto" />}
            </button>
          )}
          {showOverlayLegend && onToggleAlignOverlays && overlayLines.some(l => !l.id.startsWith('lap:')) && (
            <button
              onClick={onToggleAlignOverlays}
              className={`flex w-full items-center gap-1.5 text-[11px] font-mono ${alignOverlays ? 'text-primary' : 'text-muted-foreground'}`}
              title={t('map.alignTitle')}
            >
              <Crosshair className="w-3 h-3 shrink-0" />
              <span>{t('map.alignLines')}: {alignOverlays ? t('map.on') : t('map.off')}</span>
            </button>
          )}
          {showOverlayLegend && overlayLines.map(line => (
            <div key={line.id} className="flex items-center gap-1.5 text-[11px] font-mono">
              <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: line.color }} />
              <span className="truncate text-foreground/90">{line.label}</span>
              {onRemoveOverlay && (
                <button
                  onClick={() => onRemoveOverlay(line.id)}
                  className="ml-auto shrink-0 text-muted-foreground hover:text-destructive"
                  title={t('overlays.remove')}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!isOnline && (
        <div className="absolute bottom-2 left-2 z-[1000] flex items-center gap-1 text-xs text-amber-500">
          <WifiOff className="w-3 h-3" /> {t('map.offline')}
        </div>
      )}
    </div>
  );
}
