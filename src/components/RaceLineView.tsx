import { useEffect, useRef, useMemo, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import { GpsSample, Course, ParserStats } from '@/types/racing';
import { normalizeCourseSectors } from '@/lib/courseSectors';
import { findSpeedEvents, SpeedEvent } from '@/lib/speedEvents';
import { computeHeatmapSpeedBoundsMph } from '@/lib/speedBounds';
import { buildHeatmapSegments } from '@/lib/speedHeatmap';
import { formatLapTime } from '@/lib/lapCalculation';
import { detectBrakingZones, BrakingZoneConfig } from '@/lib/brakingZones';
import { unionBounds, cropOverlayLinesToWindow, type OverlayLine } from '@/lib/lapOverlays';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useWaybackImagery } from '@/hooks/useWaybackImagery';
import { DEFAULT_SATELLITE_TILE_URL } from '@/lib/satelliteImagery';
import { updatePositionMarker } from '@/components/map/positionArrowMarker';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { usePlaybackContext } from '@/contexts/PlaybackContext';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Moon, Satellite, Square, WifiOff, CloudSun, FileText, X, Crosshair, List, ChevronDown, ChevronUp, CalendarClock } from 'lucide-react';
import { WeatherPanel } from '@/components/WeatherPanel';
import { LocalWeatherDialog } from '@/components/LocalWeatherDialog';
import { WeatherStation, WeatherData } from '@/lib/weatherService';
import 'leaflet/dist/leaflet.css';

type MapStyle = 'dark' | 'satellite' | 'none';

const NO_OVERLAY_LINES: OverlayLine[] = [];

const mapStyleConfig = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
  },
  satellite: {
    url: DEFAULT_SATELLITE_TILE_URL,
    attribution: '&copy; Esri',
  },
  none: null,
};

interface RaceLineViewProps {
  samples: GpsSample[];
  allSamples?: GpsSample[]; // Full session samples for computing stats (not affected by range slider)
  referenceSamples?: GpsSample[];
  course: Course | null;
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
  paceDiff?: number | null;
  paceDiffLabel?: 'best' | 'ref';
  deltaTopSpeed?: number | null;
  deltaMinSpeed?: number | null;
  referenceLapNumber?: number | null;
  lapToFastestDelta?: number | null; // Direct lap time difference to fastest
  showOverlays?: boolean;
  lapTimeMs?: number | null;
  refAvgTopSpeed?: number | null;
  refAvgMinSpeed?: number | null;
  sessionGpsPoint?: { lat: number; lon: number };
  sessionStartDate?: Date;
  sessionFileName?: string | null;
  cachedWeatherStation?: WeatherStation | null;
  onWeatherStationResolved?: (station: WeatherStation) => void;
  /** Read-only leaderboard view: hide/disable the weather panel + fetch. */
  readOnly?: boolean;
  isAllLaps?: boolean;
  parserStats?: ParserStats | null;
  /** Extra racing lines (other laps / snapshots) to overlay, beneath the current lap. */
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

export function RaceLineView({ samples, allSamples, referenceSamples = [], course, bounds, paceDiff = null, paceDiffLabel = 'best', deltaTopSpeed = null, deltaMinSpeed = null, referenceLapNumber = null, lapToFastestDelta = null, showOverlays = true, lapTimeMs = null, refAvgTopSpeed = null, refAvgMinSpeed = null, sessionGpsPoint, sessionStartDate, sessionFileName, cachedWeatherStation, onWeatherStationResolved, readOnly = false, isAllLaps, parserStats, overlayLines = [], rangeStart = 0, onRemoveOverlay, alignOverlays, onToggleAlignOverlays, showOverlayLegend = true, onToggleOverlayLegend }: RaceLineViewProps) {
  const { t } = useTranslation('session');
  const { useKph, brakingZoneSettings } = useSettingsContext();
  const { currentIndex } = usePlaybackContext();
  // Use allSamples for statistics if provided, otherwise fall back to samples
  const samplesForStats = allSamples ?? samples;

  // Crop overlay racing lines to the same playback window as the active lap, so
  // cropping the range shrinks them on the map exactly like the heatmap line
  // (`samples` is already the cropped window; `samplesForStats` is the full lap).
  // Stable empty reference when no overlays — the fitBounds effect keys on this,
  // and a fresh [] per range tick would re-fit the map on every slider movement.
  const drawnOverlayLines = useMemo(
    () => (overlayLines.length === 0
      ? NO_OVERLAY_LINES
      : cropOverlayLinesToWindow(overlayLines, samplesForStats, rangeStart, rangeStart + samples.length - 1)),
    [overlayLines, samplesForStats, rangeStart, samples.length],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polylineLayerRef = useRef<L.LayerGroup | null>(null);
  const referenceLayerRef = useRef<L.LayerGroup | null>(null);
  const overlayLinesLayerRef = useRef<L.LayerGroup | null>(null);
  const brakingZonesLayerRef = useRef<L.LayerGroup | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const startFinishRef = useRef<L.Polyline | null>(null);
  const sectorsLayerRef = useRef<L.LayerGroup | null>(null);
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
  const [showWeather, setShowWeather] = useState(true);
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');

  // Satellite imagery date (Esri Wayback). '' = current best-available mosaic.
  const [satelliteDate, setSatelliteDate] = useState('');
  const wayback = useWaybackImagery();
  const loadWayback = wayback.load;
  // Pull the Wayback release list the first time the user opens satellite view.
  useEffect(() => {
    if (mapStyle === 'satellite') loadWayback();
  }, [mapStyle, loadWayback]);
  const satelliteTileUrl = useMemo(() => {
    if (!satelliteDate) return DEFAULT_SATELLITE_TILE_URL;
    return wayback.releases.find((r) => r.date === satelliteDate)?.tileUrl
      ?? DEFAULT_SATELLITE_TILE_URL;
  }, [satelliteDate, wayback.releases]);

  // Calculate dropped packets: gaps in sample timestamps larger than expected
  const droppedPacketInfo = useMemo(() => {
    if (samples.length < 10) return null;
    
    // Calculate time diffs between consecutive samples
    const timeDiffs: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      const diff = samples[i].t - samples[i - 1].t;
      if (diff > 0 && diff < 1000) timeDiffs.push(diff);
    }
    if (timeDiffs.length === 0) return null;
    
    // Median interval = expected interval
    const sorted = [...timeDiffs].sort((a, b) => a - b);
    const medianInterval = sorted[Math.floor(sorted.length / 2)];
    const hz = 1000 / medianInterval;
    
    // A "drop" is any gap > 1.5x the median interval
    const dropThreshold = medianInterval * 1.5;
    let droppedCount = 0;
    for (let i = 1; i < samples.length; i++) {
      const diff = samples[i].t - samples[i - 1].t;
      if (diff > dropThreshold) {
        // Estimate how many packets were missed in this gap
        droppedCount += Math.round(diff / medianInterval) - 1;
      }
    }
    
    const totalExpected = samples.length + droppedCount;
    const dropRate = totalExpected > 0 ? (droppedCount / totalExpected) * 100 : 0;
    
    return { droppedCount, hz, dropRate, totalSamples: samples.length, totalExpected };
  }, [samples]);
  const [sessionWeatherData, setSessionWeatherData] = useState<WeatherData | null>(null);
  const [sessionMetarOpen, setSessionMetarOpen] = useState(false);
  const isOnline = useOnlineStatus();

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

  // Compute braking zones from visible samples
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
      // Canvas renderer: vector layers (heatmap, overlays, braking zones)
      // share one <canvas> instead of one SVG DOM node per layer.
      preferCanvas: true,
    }).setView([0, 0], 16);

    // Add initial tile layer (dark)
    const config = mapStyleConfig.dark;
    if (config) {
      tileLayerRef.current = L.tileLayer(config.url, {
        attribution: config.attribution,
        maxZoom: 21,
      }).addTo(map);
    }

    // Add zoom control to bottom left
    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    // Create layer group for reference polylines (rendered underneath)
    referenceLayerRef.current = L.layerGroup().addTo(map);

    // Create layer group for braking zones (above reference, below race line)
    brakingZonesLayerRef.current = L.layerGroup().addTo(map);

    // Create layer group for multi-lap overlay lines (above braking, below the
    // current lap — current lap always stays on top)
    overlayLinesLayerRef.current = L.layerGroup().addTo(map);

    // Create layer group for current lap polylines
    polylineLayerRef.current = L.layerGroup().addTo(map);
    
    // Create layer group for speed event markers (on top)
    speedEventsLayerRef.current = L.layerGroup().addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      referenceLayerRef.current = null;
      overlayLinesLayerRef.current = null;
      brakingZonesLayerRef.current = null;
      speedEventsLayerRef.current = null;
      tileLayerRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // Update tile layer when map style changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing tile layer
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    // Add new tile layer if not "none"
    const config = mapStyleConfig[mapStyle];
    if (config) {
      const url = mapStyle === 'satellite' ? satelliteTileUrl : config.url;
      tileLayerRef.current = L.tileLayer(url, {
        attribution: config.attribution,
        maxZoom: 21,
      }).addTo(map);
      // Move tile layer to bottom
      tileLayerRef.current.bringToBack();
    }
  }, [mapStyle, satelliteTileUrl]);

  // Fit the view — its own effect so a range-slider drag (which rebuilds the
  // heatmap) doesn't re-fit the map on every movement.
  const hasSamples = samples.length > 0;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasSamples) return;

    // Include overlay extents so off-lap overlays aren't clipped
    const fit = unionBounds(bounds, drawnOverlayLines);
    const latLngBounds = L.latLngBounds([
      [fit.minLat, fit.minLon],
      [fit.maxLat, fit.maxLon]
    ]);
    map.fitBounds(latLngBounds, { padding: [20, 20] });
  }, [bounds, drawnOverlayLines, hasSamples]);

  // Draw the reference line (underneath) as grey
  useEffect(() => {
    const referenceLayer = referenceLayerRef.current;
    if (!referenceLayer) return;
    referenceLayer.clearLayers();
    if (referenceSamples.length === 0) return;
    const refCoords = referenceSamples.map(s => [s.lat, s.lon] as [number, number]);
    referenceLayer.addLayer(L.polyline(refCoords, {
      color: 'hsl(220, 10%, 50%)',
      weight: 4,
      opacity: 0.6,
      interactive: false,
    }));
  }, [referenceSamples]);

  // Draw the speed-colored race line: one multi-part polyline per color bucket
  // (~20 canvas layers) instead of one layer per GPS segment, which emitted an
  // SVG <path> per sample pair and froze the tab on full-session ranges.
  useEffect(() => {
    const polylineLayer = polylineLayerRef.current;
    if (!polylineLayer) return;
    polylineLayer.clearLayers();
    for (const bucket of buildHeatmapSegments(samples, minSpeed, maxSpeed)) {
      polylineLayer.addLayer(L.polyline(bucket.parts, {
        color: bucket.color,
        weight: 4,
        opacity: 0.9,
        interactive: false,
      }));
    }
  }, [samples, minSpeed, maxSpeed]);

  // Draw multi-lap overlay lines (other laps / snapshots) — solid colors,
  // beneath the current lap. Rebuilt only when the overlay set changes.
  useEffect(() => {
    const layer = overlayLinesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const line of drawnOverlayLines) {
      const coords = line.samples.map(s => [s.lat, s.lon] as [number, number]);
      layer.addLayer(L.polyline(coords, { color: line.color, weight: 4, opacity: 0.7 }));
    }
  }, [drawnOverlayLines]);

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

  // Update braking zones layer
  useEffect(() => {
    const map = mapRef.current;
    const brakingZonesLayer = brakingZonesLayerRef.current;
    if (!map || !brakingZonesLayer) return;

    brakingZonesLayer.clearLayers();

    if (!showBrakingZones || brakingZones.length === 0) return;

    // Draw each braking zone as a polyline following the GPS path
    const zoneColor = brakingZoneSettings?.color ?? 'hsl(210, 90%, 55%)';
    const zoneWidth = brakingZoneSettings?.width ?? 10;
    
    brakingZones.forEach((zone) => {
      const coords = zone.path.map(p => [p.lat, p.lon] as [number, number]);
      const polyline = L.polyline(coords, {
        color: zoneColor,
        weight: zoneWidth,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round',
      });
      brakingZonesLayer.addLayer(polyline);
    });
  }, [brakingZones, showBrakingZones, brakingZoneSettings?.color, brakingZoneSettings?.width]);

  // Update start/finish line and sector lines when course changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing timing lines
    if (startFinishRef.current) {
      map.removeLayer(startFinishRef.current);
      startFinishRef.current = null;
    }
    if (sectorsLayerRef.current) {
      map.removeLayer(sectorsLayerRef.current);
      sectorsLayerRef.current = null;
    }

    if (!course) return;

    // Draw start/finish line (red)
    startFinishRef.current = L.polyline(
      [[course.startFinishA.lat, course.startFinishA.lon], [course.startFinishB.lat, course.startFinishB.lon]],
      { color: 'hsl(0, 75%, 55%)', weight: 5, opacity: 1 }
    ).addTo(map);

    // Draw every sector line: majors purple, sub-sectors sky-blue (secondary).
    const sectors = normalizeCourseSectors(course).sectors ?? [];
    if (sectors.length > 0) {
      const group = L.layerGroup();
      for (const sec of sectors) {
        const major = sec.major;
        L.polyline(
          [[sec.line.a.lat, sec.line.a.lon], [sec.line.b.lat, sec.line.b.lon]],
          major
            ? { color: 'hsl(280, 70%, 55%)', weight: 4, opacity: 0.9 }
            : { color: 'hsl(199, 89%, 60%)', weight: 3, opacity: 0.7, dashArray: '6 5' }
        ).addTo(group);
      }
      group.addTo(map);
      sectorsLayerRef.current = group;
    }
  }, [course]);


  // Update current position marker (created once, moved/rotated per tick)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRef.current = updatePositionMarker(map, markerRef.current, samples, currentIndex);
  }, [currentIndex, samples]);

  if (samples.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-background text-muted-foreground">
        No GPS data loaded
      </div>
    );
  }

  const cycleMapStyle = () => {
    setMapStyle((prev) => {
      if (prev === 'dark') return 'satellite';
      if (prev === 'satellite') return 'none';
      return 'dark';
    });
  };

  const mapStyleIcon = {
    dark: <Moon className="w-3.5 h-3.5" />,
    satellite: <Satellite className="w-3.5 h-3.5" />,
    none: <Square className="w-3.5 h-3.5" />,
  };

  const mapStyleLabel = {
    dark: t('map.styleDark'),
    satellite: t('map.styleSatellite'),
    none: t('map.styleNone'),
  };

  const unit = useKph ? 'kph' : 'mph';
  const convertSpeed = (speed: number) => useKph ? speed * 1.60934 : speed;

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full bg-black" />

      {/* Multi-lap overlay legend - bottom center */}
      {overlayLines.length > 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] flex max-w-[70%] flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded bg-card/90 backdrop-blur-sm border border-border px-2.5 py-1.5">
          {/* Collapse the per-lap list without touching the racing lines — keeps a
              crowded line-up (5+ overlays) from burying the map under labels. */}
          {onToggleOverlayLegend && (
            <button
              onClick={onToggleOverlayLegend}
              className={`flex items-center gap-1.5 text-xs font-mono ${showOverlayLegend ? 'text-primary' : 'text-muted-foreground'}`}
              title={showOverlayLegend ? t('map.overlaysCollapseTitle') : t('map.overlaysShowTitle', { count: overlayLines.length })}
            >
              <List className="w-3 h-3 shrink-0" />
              <span>{showOverlayLegend ? t('map.overlays') : t('map.overlayCount', { count: overlayLines.length })}</span>
              {showOverlayLegend ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronUp className="w-3 h-3 shrink-0" />}
            </button>
          )}
          {showOverlayLegend && onToggleAlignOverlays && overlayLines.some(l => !l.id.startsWith('lap:')) && (
            <button
              onClick={onToggleAlignOverlays}
              className={`flex items-center gap-1.5 text-xs font-mono ${alignOverlays ? 'text-primary' : 'text-muted-foreground'}`}
              title={t('map.alignTitle')}
            >
              <Crosshair className="w-3 h-3 shrink-0" />
              <span>{t('map.align')}: {alignOverlays ? t('map.on') : t('map.off')}</span>
            </button>
          )}
          {showOverlayLegend && overlayLines.map(line => (
            <div key={line.id} className="flex items-center gap-1.5 text-xs font-mono">
              <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: line.color }} />
              <span className="truncate max-w-[140px] text-foreground/90">{line.label}</span>
              {onRemoveOverlay && (
                <button
                  onClick={() => onRemoveOverlay(line.id)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  title={t('overlays.remove')}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Controls panel */}
      {showOverlays && (
        <div className="absolute top-4 left-4 bg-card/90 backdrop-blur-sm border border-border rounded p-2 z-[1000] transition-opacity duration-200">
          {/* Map style toggle */}
          <button
            onClick={cycleMapStyle}
            className="flex items-center gap-2 w-full px-2 py-1 rounded hover:bg-muted/50 transition-colors mb-2"
          >
            {mapStyleIcon[mapStyle]}
            <span className="text-xs text-muted-foreground">{t('map.mapPrefix')}: {mapStyleLabel[mapStyle]}</span>
          </button>

          {/* Satellite imagery date — pick an older Esri Wayback capture to dodge
              clouds/seasonal cover in the current mosaic (online-only). */}
          {mapStyle === 'satellite' && (
            <div className="mb-2 -mt-1 px-2">
              {!isOnline ? (
                <p className="text-[11px] text-muted-foreground">{t('map.imageryNeedsConnection')}</p>
              ) : wayback.error ? (
                <p className="text-[11px] text-muted-foreground">{t('map.imageryUnavailable')}</p>
              ) : (
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <CalendarClock className="w-3 h-3 shrink-0" />
                  <select
                    value={satelliteDate}
                    onChange={(e) => setSatelliteDate(e.target.value)}
                    disabled={wayback.loading && wayback.releases.length === 0}
                    className="flex-1 min-w-0 bg-transparent text-foreground/90 text-[11px] outline-none cursor-pointer"
                    title={t('map.imageryDateTitle')}
                  >
                    <option value="">{wayback.loading ? t('map.imageryLoading') : t('map.imageryLatest')}</option>
                    {wayback.releases.map((r) => (
                      <option key={r.releaseNum} value={r.date}>{r.date}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          <div className="border-t border-border pt-2">
            <div className="flex items-center gap-2">
              <Switch 
                id="speed-events" 
                checked={showSpeedEvents} 
                onCheckedChange={setShowSpeedEvents}
                className="scale-75"
              />
              <Label htmlFor="speed-events" className="text-xs text-muted-foreground cursor-pointer">
                {t('map.speedEvents')}
              </Label>
            </div>
            {showSpeedEvents && speedEventsForMarkers.length > 0 && (
              <div className="flex items-center gap-3 mt-2 text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(142, 76%, 36%)' }} />
                  <span className="text-muted-foreground">{t('map.peak')}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(0, 84%, 50%)' }} />
                  <span className="text-muted-foreground">{t('map.valley')}</span>
                </div>
              </div>
            )}

            {/* Braking zones toggle */}
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border">
              <Switch 
                id="braking-zones" 
                checked={showBrakingZones} 
                onCheckedChange={setShowBrakingZones}
                className="scale-75"
              />
              <Label htmlFor="braking-zones" className="text-xs text-muted-foreground cursor-pointer">
                {t('map.brakingZones')}
              </Label>
            </div>
            {showBrakingZones && brakingZones.length > 0 && (
              <div className="flex items-center gap-1 mt-1 text-xs">
                <div 
                  className="w-3 h-3 rounded" 
                  style={{ backgroundColor: brakingZoneSettings?.color ?? 'hsl(210, 90%, 55%)' }} 
                />
                <span className="text-muted-foreground">{t('map.brakingCount', { count: brakingZones.length })}</span>
              </div>
            )}
          </div>
          {!isOnline && (
            <div className="border-t border-border pt-2 mt-2">
              <div className="flex items-center gap-1.5 text-xs text-amber-500">
                <WifiOff className="w-3 h-3" />
                <span>{t('map.mapsOffline')}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Weather UI — hidden entirely in the read-only leaderboard view. */}
      {!readOnly && (
        <>
          {/* Session METAR detail button - bottom right, left of weather toggle */}
          {showWeather && sessionWeatherData && (
            <button
              onClick={() => setSessionMetarOpen(true)}
              className="absolute bottom-4 right-14 z-[1000] p-2 rounded bg-card/90 backdrop-blur-sm border border-border transition-colors hover:bg-muted/50 text-primary"
              title={t('map.metarDetail')}
            >
              <FileText className="w-4 h-4" />
            </button>
          )}

          {/* Weather toggle button - bottom right */}
          <button
            onClick={() => setShowWeather(prev => !prev)}
            className={`absolute bottom-4 right-4 z-[1000] p-2 rounded bg-card/90 backdrop-blur-sm border border-border transition-colors hover:bg-muted/50 ${showWeather ? 'text-primary' : 'text-muted-foreground'}`}
            title={showWeather ? t('map.weatherHide') : t('map.weatherShow')}
          >
            <CloudSun className="w-4 h-4" />
          </button>

          {/* Session METAR dialog */}
          <LocalWeatherDialog
            sessionWeather={sessionWeatherData}
            externalOpen={sessionMetarOpen}
            onExternalOpenChange={setSessionMetarOpen}
          />
        </>
      )}

      {/* Speed legend and stats panel */}
      {showOverlays && (
        <div className="absolute top-4 right-4 bg-card/90 backdrop-blur-sm border border-border rounded p-2 z-[1000] min-w-[120px] transition-opacity duration-200">
          <div className="text-xs text-muted-foreground mb-1">{t('map.speedLegend', { unit })}</div>
          <div className="w-full h-3 speed-gradient rounded" />
          <div className="flex justify-between text-xs text-muted-foreground mt-1 font-mono">
            <span>{convertSpeed(minSpeed).toFixed(0)}</span>
            <span>{convertSpeed(maxSpeed).toFixed(0)}</span>
          </div>
          
          {/* Lap time and average speed stats - only show when course is selected */}
          {course && speedEventsForStats.length > 0 && (() => {
            const peaks = speedEventsForStats.filter(e => e.type === 'peak');
            const valleys = speedEventsForStats.filter(e => e.type === 'valley');
            const avgTop = peaks.length > 0 
              ? peaks.reduce((sum, e) => sum + e.speed, 0) / peaks.length 
              : null;
            const avgMin = valleys.length > 0 
              ? valleys.reduce((sum, e) => sum + e.speed, 0) / valleys.length 
              : null;
            
            return (
              <div className="mt-3 pt-2 border-t border-border space-y-1">
                {/* Lap Time - shown above Avg Top Speed */}
                {lapTimeMs !== null && (
                  <div className="flex justify-between text-xs mb-2 pb-2 border-b border-border">
                    <span className="text-muted-foreground">{t('stats.lapTime')}:</span>
                    <span className="font-mono text-foreground font-semibold">
                      {formatLapTime(lapTimeMs)}
                    </span>
                  </div>
                )}
                
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{t('stats.avgTopSpeed')}:</span>
                  <span className="font-mono" style={{ color: 'hsl(142, 76%, 45%)' }}>
                    {avgTop !== null ? `${convertSpeed(avgTop).toFixed(1)} ${unit}` : '—'}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{t('stats.avgMinSpeed')}:</span>
                  <span className="font-mono" style={{ color: 'hsl(0, 84%, 55%)' }}>
                    {avgMin !== null ? `${convertSpeed(avgMin).toFixed(1)} ${unit}` : '—'}
                  </span>
                </div>
                
                {/* Delta section with reference averages */}
                {(referenceLapNumber !== null || lapToFastestDelta !== null || deltaTopSpeed !== null || deltaMinSpeed !== null) && (
                  <div className="mt-2 pt-2 border-t border-border space-y-1">
                    <div className="text-xs text-muted-foreground mb-1 text-center">
                      Δ {paceDiffLabel === 'best' ? t('stats.best') : t('stats.ref')}
                    </div>
                    {referenceLapNumber !== null && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Δ {t('stats.lap')}</span>
                        <span className="font-mono text-foreground">{referenceLapNumber}</span>
                      </div>
                    )}
                    {lapToFastestDelta !== null && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Δ {t('stats.time')}:</span>
                        <span 
                          className="font-mono"
                          style={{ color: lapToFastestDelta < 0 ? 'hsl(142, 76%, 45%)' : lapToFastestDelta > 0 ? 'hsl(0, 84%, 55%)' : 'hsl(var(--muted-foreground))' }}
                        >
                          {lapToFastestDelta > 0 ? '+' : ''}{(lapToFastestDelta / 1000).toFixed(3)}s
                        </span>
                      </div>
                    )}
                    {deltaTopSpeed !== null && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Δ {t('stats.topSpeed')}:</span>
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
                        <span className="text-muted-foreground">Δ {t('stats.minSpeed')}:</span>
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
          
          {/* Weather panel - below delta section */}
          {!readOnly && showWeather && (
            <div className="mt-3 pt-2 border-t border-border">
              <WeatherPanel
                lat={sessionGpsPoint?.lat}
                lon={sessionGpsPoint?.lon}
                sessionDate={sessionStartDate}
                sessionFileName={sessionFileName}
                cachedStation={cachedWeatherStation}
                onStationResolved={onWeatherStationResolved}
                onWeatherLoaded={setSessionWeatherData}
              />
            </div>
          )}
        </div>
      )}

      {/* Dropped packet / rejected row indicator */}
      {((droppedPacketInfo?.droppedCount ?? 0) > 0 || (parserStats && parserStats.acceptedRows < parserStats.totalRows)) && (
        <div className="absolute bottom-2 left-12 z-[1000] bg-card/80 backdrop-blur-sm border border-border rounded px-2 py-1 text-xs font-mono text-muted-foreground">
          {droppedPacketInfo && droppedPacketInfo.droppedCount > 0 && (
            <div>
              <span className="text-destructive font-semibold">{droppedPacketInfo.droppedCount}</span>
              {' '}{t('map.pktDropped', {
                count: droppedPacketInfo.droppedCount,
                loss: droppedPacketInfo.dropRate.toFixed(1),
                hz: droppedPacketInfo.hz.toFixed(0),
              })}
            </div>
          )}
          {parserStats && parserStats.acceptedRows < parserStats.totalRows && (() => {
            const r = parserStats.rejected;
            const totalRejected = parserStats.totalRows - parserStats.acceptedRows;
            const reasons: string[] = [];
            if (r.teleportation > 0) reasons.push(`${r.teleportation} ${t('map.reasonTeleport')}`);
            if (r.nanFields > 0) reasons.push(`${r.nanFields} ${t('map.reasonNan')}`);
            if (r.zeroCoords > 0) reasons.push(`${r.zeroCoords} ${t('map.reasonZeroCoord')}`);
            if (r.outOfRange > 0) reasons.push(`${r.outOfRange} ${t('map.reasonOor')}`);
            if (r.speedCap > 0) reasons.push(`${r.speedCap} ${t('map.reasonSpeedCap')}`);
            if (r.incompleteRow > 0) reasons.push(`${r.incompleteRow} ${t('map.reasonShortRow')}`);
            return (
              <div>
                <span className="text-yellow-500 font-semibold">{totalRejected}</span>
                {' '}{t('map.rowsRejected', { count: totalRejected })}
                {reasons.length > 0 && ` (${reasons.join(', ')})`}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
