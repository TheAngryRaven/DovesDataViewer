import { useState, useEffect, useCallback, useMemo, useRef, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, LocateFixed, Pencil, Undo2, Trash2, Route, Eye, EyeOff, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { SectorLine, CourseSector } from '@/types/racing';
import type { Lap, GpsSample } from '@/types/racing';
import { sectorLabels, centeredSectorLine } from '@/lib/courseSectors';
import { resamplePolyline, calculatePolylineLength, generatedDrawingSpacing } from '@/lib/trackUtils';
import { useWaybackImagery } from '@/hooks/useWaybackImagery';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { DEFAULT_SATELLITE_TILE_URL } from '@/lib/satelliteImagery';
import { isDebugEnabled } from '@/lib/debugConsole';
import L from 'leaflet';

export interface GpsPoint {
  lat: number;
  lon: number;
}

/** Identifies an editable timing line: 'sf' = start/finish, number = sectors[index]. */
export type LineId = 'sf' | number;

// Line colors: start/finish green, major sectors purple, sub-sectors sky-blue.
const COLOR_SF = '#22c55e';
const COLOR_MAJOR = '#a855f7';
const COLOR_SUB = '#38bdf8';

interface VisualEditorProps {
  startFinishA: GpsPoint | null;
  startFinishB: GpsPoint | null;
  /** Ordered sector lines after start/finish. */
  sectors: CourseSector[];
  /** Currently-selected line (controlled by the sector list), or null. */
  selectedLine: LineId | null;
  onSelectLine?: (id: LineId | null) => void;
  onStartFinishChange?: (a: GpsPoint, b: GpsPoint) => void;
  onSectorLineChange?: (index: number, line: SectorLine) => void;
  isNewTrack?: boolean;
  /** Initial map center from loaded GPS data */
  initialCenter?: GpsPoint | null;
  /** Whether to show the Draw/Generate tools */
  showDrawTool?: boolean;
  /** Existing layout drawing to display as a static polyline */
  layoutPoints?: Array<{ lat: number; lon: number }>;
  /** Show a button to toggle visibility of known drawing */
  showKnownDrawingToggle?: boolean;
  /** Callback when layout drawing changes */
  onLayoutChange?: (points: Array<{ lat: number; lon: number }>) => void;
  /** Laps available for "Generate Drawing" */
  laps?: Lap[];
  /** GPS samples for generating drawing from lap data */
  samples?: GpsSample[];
  /** Kept in sync with the map's current view center, so an added sector can be
   *  dropped in the middle of what the user is looking at (without panning). */
  viewCenterRef?: MutableRefObject<GpsPoint | null>;
}

interface VisualEditorToolbarProps {
  drawMode: boolean;
  onToggleDraw: () => void;
  showDrawTool?: boolean;
  drawPointCount?: number;
  canToggleKnownDrawing?: boolean;
  showKnownDrawing?: boolean;
  onToggleKnownDrawing?: () => void;
  onUndoDraw?: () => void;
  onClearDraw?: () => void;
  laps?: Lap[];
  onGenerateFromLap?: (lapNumber: number) => void;
  /** Whole-session GPS available — enables Generate even with no detected laps. */
  hasSamples?: boolean;
  onGenerateFromSession?: () => void;
}

function VisualEditorToolbar({ drawMode, onToggleDraw, showDrawTool, drawPointCount = 0, canToggleKnownDrawing = false, showKnownDrawing = true, onToggleKnownDrawing, onUndoDraw, onClearDraw, laps, onGenerateFromLap, hasSamples = false, onGenerateFromSession }: VisualEditorToolbarProps) {
  const { t } = useTranslation('tracks');
  const [showLapPicker, setShowLapPicker] = useState(false);
  const hasLaps = !!laps && laps.length > 0;
  const canGenerate = hasLaps || hasSamples;

  const handleGenerateClick = () => {
    if (!canGenerate) return;
    // No laps to choose from → generate straight from the whole session.
    if (!hasLaps) {
      onGenerateFromSession?.();
      return;
    }
    setShowLapPicker(true);
  };

  const handleLapSelect = (lapNumber: number) => {
    setShowLapPicker(false);
    onGenerateFromLap?.(lapNumber);
  };

  const handleSessionSelect = () => {
    setShowLapPicker(false);
    onGenerateFromSession?.();
  };

  const formatLapTime = (ms: number) => {
    const totalSecs = ms / 1000;
    const mins = Math.floor(totalSecs / 60);
    const secs = (totalSecs % 60).toFixed(3);
    return mins > 0 ? `${mins}:${secs.padStart(6, '0')}` : `${secs}s`;
  };

  // Nothing to show in the toolbar unless drawing tools are enabled.
  if (!showDrawTool && !canToggleKnownDrawing) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 p-2 bg-card border border-border rounded-lg flex-wrap">
        {showDrawTool && (
            <Button
              variant={drawMode ? 'default' : 'outline'}
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={onToggleDraw}
            >
              <Pencil className="w-3.5 h-3.5" />
              {t('visual.draw')}
            </Button>
        )}
        {showDrawTool && canGenerate && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handleGenerateClick}
              >
                <Route className="w-3.5 h-3.5" />
                {t('visual.generate')}
              </Button>
        )}
        {canToggleKnownDrawing && (
          <Button
            variant={showKnownDrawing ? 'secondary' : 'outline'}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onToggleKnownDrawing}
          >
            {showKnownDrawing ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {t('visual.toggleKnownDrawing')}
          </Button>
        )}
        {drawMode && drawPointCount > 0 && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={onUndoDraw}
            >
              <Undo2 className="w-3.5 h-3.5" />
              {t('visual.undo')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
              onClick={onClearDraw}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('visual.clear')}
            </Button>
          </>
        )}
      </div>
      {showLapPicker && (
        <div className="p-3 bg-card border border-border rounded-lg space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t('visual.generateFrom')}</p>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
            {hasSamples && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleSessionSelect}
              >
                {t('visual.wholeSession')}
              </Button>
            )}
            {laps?.map(lap => (
              <Button
                key={lap.lapNumber}
                variant="outline"
                size="sm"
                className="h-7 text-xs font-mono"
                onClick={() => handleLapSelect(lap.lapNumber)}
              >
                {t('visual.lapOption', { number: lap.lapNumber, time: formatLapTime(lap.lapTimeMs) })}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowLapPicker(false)}>
            {t('visual.cancel')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function VisualEditor({
  startFinishA, startFinishB, sectors, selectedLine, onSelectLine,
  onStartFinishChange, onSectorLineChange,
  isNewTrack = false, initialCenter: initialCenterProp = null,
  showDrawTool = false, layoutPoints: layoutPointsProp, showKnownDrawingToggle = false, onLayoutChange,
  laps, samples, viewCenterRef,
}: VisualEditorProps) {
  const { t } = useTranslation('tracks');
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [drawMode, setDrawMode] = useState(false);

  // Satellite imagery date (Esri Wayback). '' = current best-available mosaic.
  // Lets the user step the basemap back to a cloud-free capture while placing
  // start/finish + sector lines. Online-only + lazy, mirroring the race-line map.
  const isOnline = useOnlineStatus();
  const wayback = useWaybackImagery();
  const loadWayback = wayback.load;
  const [satelliteDate, setSatelliteDate] = useState('');
  useEffect(() => {
    if (isOnline) loadWayback();
  }, [isOnline, loadWayback]);
  const satelliteTileUrl = useMemo(() => {
    if (!satelliteDate) return DEFAULT_SATELLITE_TILE_URL;
    return wayback.releases.find((r) => r.date === satelliteDate)?.tileUrl ?? DEFAULT_SATELLITE_TILE_URL;
  }, [satelliteDate, wayback.releases]);

  // Pending coordinates for the line currently being dragged.
  const [pendingLine, setPendingLine] = useState<{ id: LineId; coords: { a: GpsPoint; b: GpsPoint } } | null>(null);

  // Drawing state. The ref mirrors drawPoints so the draw handlers can read the
  // latest points synchronously and auto-save each change to the parent.
  const [drawPoints, setDrawPoints] = useState<Array<{ lat: number; lon: number }>>(layoutPointsProp ?? []);
  const drawPointsRef = useRef<Array<{ lat: number; lon: number }>>(layoutPointsProp ?? []);
  const [showKnownDrawing, setShowKnownDrawing] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const drawPolylineRef = useRef<L.Polyline | null>(null);
  const drawClickHandlerRef = useRef<((e: L.LeafletMouseEvent) => void) | null>(null);

  // Sync drawPoints when layoutPointsProp changes (e.g. async load from DB)
  useEffect(() => {
    const incoming = layoutPointsProp ?? [];
    drawPointsRef.current = incoming;
    setDrawPoints(incoming);
    if (incoming.length > 0) setShowKnownDrawing(true);
    if (mapRef.current && drawPolylineRef.current) {
      if (incoming.length > 0) {
        drawPolylineRef.current.setLatLngs(incoming.map(p => [p.lat, p.lon] as [number, number]));
      } else {
        drawPolylineRef.current.remove();
        drawPolylineRef.current = null;
      }
    }
  }, [layoutPointsProp]);

  // Layer refs for markers and active polyline
  const markersRef = useRef<L.Marker[]>([]);
  const activeLineRef = useRef<L.Polyline | null>(null);
  const staticLinesRef = useRef<L.Polyline[]>([]);

  // Latest selection / callbacks for use inside Leaflet event handlers (refs so
  // the marker-drag closures always see current values without re-binding).
  const onSelectLineRef = useRef(onSelectLine);
  onSelectLineRef.current = onSelectLine;

  // Location search state (only used when isNewTrack)
  const [searchQuery, setSearchQuery] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  // Color for a given line id.
  const colorFor = useCallback((id: LineId): string => {
    if (id === 'sf') return COLOR_SF;
    return sectors[id]?.major ? COLOR_MAJOR : COLOR_SUB;
  }, [sectors]);

  // Current coordinates for a given line id (pending drag wins).
  const coordsFor = useCallback((id: LineId): { a: GpsPoint; b: GpsPoint } | null => {
    if (pendingLine && pendingLine.id === id) return pendingLine.coords;
    if (id === 'sf') {
      if (startFinishA && startFinishB) return { a: startFinishA, b: startFinishB };
      return null;
    }
    const sec = sectors[id];
    return sec ? { a: sec.line.a, b: sec.line.b } : null;
  }, [pendingLine, startFinishA, startFinishB, sectors]);

  // All line ids in course order (start/finish first).
  const allLineIds = useMemo<LineId[]>(() => ['sf', ...sectors.map((_, i) => i)], [sectors]);

  // For a brand-new course the start/finish line has no coordinates yet, so it
  // can't be rendered or dragged. Drop it in the center of the chosen view — when
  // the venue is already known (GPS center) on mount, or right after the user
  // searches / locates. Gated on "no S/F yet" so it never clobbers a placed line;
  // the reset button re-drops on demand.
  const maybeDropStartFinish = useCallback((center: GpsPoint) => {
    if (!isNewTrack || (startFinishA && startFinishB)) return;
    const line = centeredSectorLine(center);
    onStartFinishChange?.(line.a, line.b);
    onSelectLineRef.current?.('sf');
  }, [isNewTrack, startFinishA, startFinishB, onStartFinishChange]);

  // Location search using Nominatim
  const handleLocationSearch = useCallback(async () => {
    if (!searchQuery.trim() || !mapRef.current) return;

    setIsSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery.trim())}`,
        { headers: { 'User-Agent': 'DovesDataViewer/1.0' } }
      );
      const results = await response.json();

      if (results && results.length > 0) {
        const { lat, lon } = results[0];
        mapRef.current.setView([parseFloat(lat), parseFloat(lon)], 17, { animate: true });
        setSearchQuery('');
        // The user just chose their venue — drop the start/finish here if it
        // hasn't been placed yet, so it lands in view rather than at the default.
        maybeDropStartFinish({ lat: parseFloat(lat), lon: parseFloat(lon) });
      } else {
        toast({ title: t('visual.locNotFound'), description: t('visual.locNotFoundDesc'), variant: 'destructive' });
      }
    } catch {
      toast({ title: t('visual.searchFailed'), description: t('visual.searchFailedDesc'), variant: 'destructive' });
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, t, maybeDropStartFinish]);

  // Calculate center from existing points, GPS data, or default
  const getInitialCenter = (): [number, number] => {
    if (startFinishA && startFinishB) {
      return [(startFinishA.lat + startFinishB.lat) / 2, (startFinishA.lon + startFinishB.lon) / 2];
    }
    if (initialCenterProp) {
      return [initialCenterProp.lat, initialCenterProp.lon];
    }
    return [28.4120, -81.3797];
  };

  // Use device geolocation to center the map
  const handleUseMyLocation = useCallback(() => {
    if (!mapRef.current || !navigator.geolocation) {
      toast({ title: t('visual.geoUnavailable'), description: t('visual.geoUnavailableDesc'), variant: 'destructive' });
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 17, { animate: true });
        maybeDropStartFinish({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setIsLocating(false);
      },
      (err) => {
        toast({ title: t('visual.locError'), description: err.message, variant: 'destructive' });
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [t, maybeDropStartFinish]);

  // Clear interactive editing layers
  const clearEditingLayers = () => {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (activeLineRef.current) {
      activeLineRef.current.remove();
      activeLineRef.current = null;
    }
  };

  // Draw static lines (all lines except the selected one), dimmed + clickable.
  const drawStaticLines = useCallback((map: L.Map, excludeId: LineId | null) => {
    staticLinesRef.current.forEach(l => l.remove());
    staticLinesRef.current = [];

    for (const id of allLineIds) {
      if (id === excludeId) continue;
      const coords = coordsFor(id);
      if (!coords) continue;
      const polyline = L.polyline(
        [[coords.a.lat, coords.a.lon], [coords.b.lat, coords.b.lon]],
        { color: colorFor(id), weight: 6, opacity: 0.8 }
      ).addTo(map);
      // Click a static line to select it for editing.
      polyline.on('click', () => onSelectLineRef.current?.(id));
      staticLinesRef.current.push(polyline);
    }
  }, [allLineIds, coordsFor, colorFor]);

  // Create draggable markers + active line for a line id, using known coords.
  const createEditingLayersWithCoords = useCallback((map: L.Map, id: LineId, coords: { a: GpsPoint; b: GpsPoint }) => {
    clearEditingLayers();
    const color = colorFor(id);

    const polyline = L.polyline(
      [[coords.a.lat, coords.a.lon], [coords.b.lat, coords.b.lon]],
      { color, weight: 9, opacity: 1 }
    ).addTo(map);
    activeLineRef.current = polyline;

    const createMarker = (point: GpsPoint, isPointA: boolean) => {
      const marker = L.marker([point.lat, point.lon], {
        draggable: true,
        icon: L.divIcon({
          className: 'custom-marker',
          html: `<div style="width:16px;height:16px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.5);"></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
      }).addTo(map);

      marker.on('drag', (e: L.LeafletEvent) => {
        const latlng = (e.target as L.Marker).getLatLng();
        if (activeLineRef.current) {
          const otherMarker = markersRef.current.find(m => m !== marker);
          if (otherMarker) {
            const otherLatLng = otherMarker.getLatLng();
            activeLineRef.current.setLatLngs([
              [isPointA ? latlng.lat : otherLatLng.lat, isPointA ? latlng.lng : otherLatLng.lng],
              [isPointA ? otherLatLng.lat : latlng.lat, isPointA ? otherLatLng.lng : latlng.lng],
            ]);
          }
        }
      });

      marker.on('dragend', (e: L.LeafletEvent) => {
        const latlng = (e.target as L.Marker).getLatLng();
        const newPoint = { lat: latlng.lat, lon: latlng.lng };
        const otherMarker = markersRef.current.find(m => m !== marker);
        const otherLatLng = otherMarker?.getLatLng();
        const otherPoint = otherLatLng ? { lat: otherLatLng.lat, lon: otherLatLng.lng } : null;
        if (!otherPoint) return;

        const newA = isPointA ? newPoint : otherPoint;
        const newB = isPointA ? otherPoint : newPoint;

        // Save immediately on release — no separate "Done" step.
        setPendingLine({ id, coords: { a: newA, b: newB } });
        if (id === 'sf') onStartFinishChange?.(newA, newB);
        else onSectorLineChange?.(id, { a: newA, b: newB });
      });

      return marker;
    };

    const markerA = createMarker(coords.a, true);
    const markerB = createMarker(coords.b, false);
    markersRef.current = [markerA, markerB];
  }, [colorFor, onStartFinishChange, onSectorLineChange]);

  // --- Draw mode helpers ---
  const updateDrawPolyline = useCallback((points: Array<{ lat: number; lon: number }>) => {
    const map = mapRef.current;
    if (!map) return;
    if (drawPolylineRef.current) {
      drawPolylineRef.current.setLatLngs(points.map(p => [p.lat, p.lon] as [number, number]));
      drawPolylineRef.current.bringToFront();
    } else if (points.length > 0) {
      drawPolylineRef.current = L.polyline(
        points.map(p => [p.lat, p.lon] as [number, number]),
        { color: '#ff6600', weight: 7, opacity: 0.9 }
      ).addTo(map);
      drawPolylineRef.current.bringToFront();
    }
  }, []);

  const clearDrawMode = useCallback(() => {
    const map = mapRef.current;
    if (drawClickHandlerRef.current && map) {
      map.off('click', drawClickHandlerRef.current);
      drawClickHandlerRef.current = null;
    }
  }, []);

  const enterDrawMode = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    clearDrawMode();
    const handler = (e: L.LeafletMouseEvent) => {
      const next = [...drawPointsRef.current, { lat: e.latlng.lat, lon: e.latlng.lng }];
      drawPointsRef.current = next;
      setDrawPoints(next);
      updateDrawPolyline(next);
      onLayoutChange?.(next); // auto-save — no "Done" step
    };
    drawClickHandlerRef.current = handler;
    map.on('click', handler);
  }, [clearDrawMode, updateDrawPolyline, onLayoutChange]);

  const handleUndoDraw = useCallback(() => {
    const next = drawPointsRef.current.slice(0, -1);
    drawPointsRef.current = next;
    setDrawPoints(next);
    updateDrawPolyline(next);
    if (next.length === 0 && drawPolylineRef.current) {
      drawPolylineRef.current.remove();
      drawPolylineRef.current = null;
    }
    onLayoutChange?.(next);
  }, [updateDrawPolyline, onLayoutChange]);

  const handleClearDraw = useCallback(() => {
    drawPointsRef.current = [];
    setDrawPoints([]);
    if (drawPolylineRef.current) {
      drawPolylineRef.current.remove();
      drawPolylineRef.current = null;
    }
    onLayoutChange?.([]);
  }, [onLayoutChange]);

  // Resample a raw GPS trace to an even outline and commit it as the drawing.
  const applyGeneratedDrawing = useCallback((rawPoints: Array<{ lat: number; lon: number }>, label: string) => {
    const dbg = isDebugEnabled();
    if (rawPoints.length < 2) {
      if (dbg) console.warn('[generate] aborted: rawPoints < 2', { rawPoints: rawPoints.length });
      toast({ title: t('visual.notEnoughGps'), description: t('visual.notEnoughGpsDesc'), variant: 'destructive' });
      return;
    }
    try {
      const spacing = generatedDrawingSpacing(calculatePolylineLength(rawPoints));
      const points = resamplePolyline(rawPoints, spacing);
      if (dbg) console.info('[generate] resampled', { rawPoints: rawPoints.length, spacing, points: points.length, hasMap: !!mapRef.current, hasOnLayoutChange: !!onLayoutChange });
      if (points.length < 2) {
        if (dbg) console.warn('[generate] aborted: resampled points < 2', { spacing, points: points.length });
        toast({ title: t('visual.couldNotGenerate'), description: t('visual.tooShort'), variant: 'destructive' });
        return;
      }
      drawPointsRef.current = points;
      setDrawPoints(points);
      updateDrawPolyline(points);
      onLayoutChange?.(points);
      if (dbg) console.info('[generate] committed', { drawn: !!drawPolylineRef.current });
      if (mapRef.current && points.length > 1) {
        const bounds = L.latLngBounds(points.map(p => [p.lat, p.lon] as [number, number]));
        mapRef.current.fitBounds(bounds, { padding: [40, 40], animate: true });
      }
      toast({ title: t('visual.drawingGenerated'), description: t('visual.drawingGeneratedDesc', { label, count: points.length }) });
    } catch (err) {
      console.error('Drawing generation failed', err);
      toast({ title: t('visual.couldNotGenerate'), description: t('visual.seeDebug'), variant: 'destructive' });
    }
  }, [updateDrawPolyline, onLayoutChange, t]);

  const handleGenerateFromLap = useCallback((lapNumber: number) => {
    if (!samples || !laps) return;
    const lap = laps.find(l => l.lapNumber === lapNumber);
    if (!lap) return;
    const lapSamples = samples.slice(lap.startIndex, lap.endIndex + 1);
    const rawPoints = lapSamples.filter(s => s.lat !== 0 && s.lon !== 0).map(s => ({ lat: s.lat, lon: s.lon }));
    applyGeneratedDrawing(rawPoints, t('visual.generatedFromLap', { number: lapNumber }));
  }, [samples, laps, applyGeneratedDrawing, t]);

  const handleGenerateFromSession = useCallback(() => {
    if (!samples) return;
    const rawPoints = samples.filter(s => s.lat !== 0 && s.lon !== 0).map(s => ({ lat: s.lat, lon: s.lon }));
    applyGeneratedDrawing(rawPoints, t('visual.generatedFromSession'));
  }, [samples, applyGeneratedDrawing, t]);

  const handleToggleKnownDrawing = useCallback(() => {
    setShowKnownDrawing(prev => !prev);
  }, []);

  // Render static layout polyline when not in draw mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawMode) return;
    if (showKnownDrawing && drawPoints.length > 0) {
      if (!drawPolylineRef.current) {
        drawPolylineRef.current = L.polyline(
          drawPoints.map(p => [p.lat, p.lon] as [number, number]),
          { color: '#ff6600', weight: 7, opacity: 0.8, dashArray: '10 6' }
        ).addTo(map);
      } else {
        drawPolylineRef.current.setLatLngs(drawPoints.map(p => [p.lat, p.lon] as [number, number]));
        drawPolylineRef.current.setStyle({ opacity: 0.8, dashArray: '10 6' });
      }
      drawPolylineRef.current.bringToFront();
    } else if (drawPolylineRef.current) {
      drawPolylineRef.current.remove();
      drawPolylineRef.current = null;
    }
  }, [drawMode, drawPoints, showKnownDrawing, mapReady]);

  // Toggle draw mode on/off.
  const handleToggleDraw = useCallback(() => {
    const map = mapRef.current;
    setDrawMode((prev) => {
      const next = !prev;
      if (next) {
        // Entering draw mode: drop any line editing, deselect, enter draw.
        onSelectLineRef.current?.(null);
        if (map) {
          clearEditingLayers();
          drawStaticLines(map, null);
          enterDrawMode();
          if (drawPolylineRef.current) drawPolylineRef.current.setStyle({ opacity: 0.9, dashArray: undefined });
        }
      } else {
        clearDrawMode();
        if (drawPolylineRef.current) drawPolylineRef.current.setStyle({ opacity: 0.8, dashArray: '10 6' });
      }
      return next;
    });
  }, [drawStaticLines, enterDrawMode, clearDrawMode]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const center = getInitialCenter();
    const map = L.map(mapContainerRef.current, { center, zoom: 18, zoomControl: true });

    tileLayerRef.current = L.tileLayer(satelliteTileUrl, { attribution: 'Tiles © Esri', maxZoom: 21 }).addTo(map);

    mapRef.current = map;
    setMapReady(true);
    drawStaticLines(map, null);

    // Track the live view center so an added sector drops where the user is
    // looking. Seed it now and keep it current as the map is panned/zoomed.
    if (viewCenterRef) {
      const syncCenter = () => {
        const c = map.getCenter();
        viewCenterRef.current = { lat: c.lat, lon: c.lng };
      };
      syncCenter();
      map.on('moveend', syncCenter);
    }

    return () => {
      clearEditingLayers();
      clearDrawMode();
      staticLinesRef.current.forEach(l => l.remove());
      if (drawPolylineRef.current) {
        drawPolylineRef.current.remove();
        drawPolylineRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      tileLayerRef.current = null;
    };
    // Mount-only effect — Leaflet setup; helpers intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the basemap tiles when the Wayback date changes (without re-init).
  useEffect(() => {
    if (tileLayerRef.current) tileLayerRef.current.setUrl(satelliteTileUrl);
  }, [satelliteTileUrl]);

  // New course whose venue is already known (GPS-loaded): drop the start/finish
  // at that center as soon as the map is ready, so it's immediately editable.
  // Blank new tracks wait for a search / locate / reset instead, so a line never
  // lands at the default fallback location.
  useEffect(() => {
    if (!mapReady || !initialCenterProp) return;
    maybeDropStartFinish(initialCenterProp);
  }, [mapReady, initialCenterProp, maybeDropStartFinish]);

  // Handle resize
  useEffect(() => {
    if (!mapRef.current || !mapContainerRef.current) return;
    const resizeObserver = new ResizeObserver(() => mapRef.current?.invalidateSize());
    resizeObserver.observe(mapContainerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Render editing layers when the selection (or geometry) changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || drawMode) return;

    if (selectedLine !== null) {
      const coords = coordsFor(selectedLine);
      drawStaticLines(map, selectedLine);
      if (coords) {
        createEditingLayersWithCoords(map, selectedLine, coords);
      } else {
        clearEditingLayers();
      }
    } else {
      clearEditingLayers();
      drawStaticLines(map, null);
    }
    // pendingLine intentionally excluded — dragging updates the active polyline
    // imperatively; re-running here would rebuild markers mid-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLine, sectors, startFinishA, startFinishB, drawMode, mapReady, drawStaticLines, createEditingLayersWithCoords]);

  // Fit the map to the selected line when selection changes.
  const lastFitRef = useRef<LineId | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || drawMode || selectedLine === null) { lastFitRef.current = null; return; }
    if (lastFitRef.current === selectedLine) return;
    lastFitRef.current = selectedLine;
    const coords = coordsFor(selectedLine);
    if (!coords) return;
    map.fitBounds(L.latLngBounds([coords.a.lat, coords.a.lon], [coords.b.lat, coords.b.lon]), {
      padding: [80, 80], maxZoom: 20, animate: true,
    });
    // coordsFor intentionally omitted — fit only when the selected id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLine, drawMode]);

  // Clear pending drag state once the committed geometry matches (selection change).
  useEffect(() => {
    setPendingLine(null);
  }, [selectedLine]);

  const labels = useMemo(() => sectorLabels({
    name: '', startFinishA: { lat: 0, lon: 0 }, startFinishB: { lat: 0, lon: 0 }, sectors,
  }), [sectors]);

  const getHelperText = (): string => {
    if (drawMode) {
      return drawPoints.length === 0
        ? t('visual.drawStart')
        : t('visual.drawPoints', { count: drawPoints.length });
    }
    if (selectedLine === null) return '';
    const name = selectedLine === 'sf' ? t('visual.startFinishLine') : t('sectors.sectorRow', { label: labels[selectedLine + 1] ?? '' });
    const coords = coordsFor(selectedLine);
    if (!coords) return t('visual.noLineDefined', { name });
    return t('visual.dragMarkers', { name });
  };

  return (
    <div className="space-y-3">
      {isNewTrack && (
        <div className="flex gap-2">
          <Input
            placeholder={t('visual.searchLocation')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') handleLocationSearch();
            }}
            className="flex-1 h-8 text-sm"
            disabled={isSearching || !mapRef.current}
          />
          <Button variant="outline" size="sm" className="h-8 px-3" onClick={handleLocationSearch} disabled={isSearching || !searchQuery.trim() || !mapRef.current}>
            {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-3" onClick={handleUseMyLocation} disabled={isLocating || !mapRef.current} title={t('visual.useMyLocation')}>
            {isLocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />}
          </Button>
        </div>
      )}
      <VisualEditorToolbar
        drawMode={drawMode}
        onToggleDraw={handleToggleDraw}
        showDrawTool={showDrawTool}
        drawPointCount={drawPoints.length}
        canToggleKnownDrawing={showKnownDrawingToggle && drawPoints.length > 1}
        showKnownDrawing={showKnownDrawing}
        onToggleKnownDrawing={handleToggleKnownDrawing}
        onUndoDraw={handleUndoDraw}
        onClearDraw={handleClearDraw}
        laps={laps}
        onGenerateFromLap={handleGenerateFromLap}
        hasSamples={!!samples && samples.length >= 2}
        onGenerateFromSession={handleGenerateFromSession}
      />
      {showDrawTool && (
        <p className="text-xs text-muted-foreground">
          {t('visual.drawingHelps')}
        </p>
      )}
      {/* Satellite imagery date — step the basemap back to a cloud-free Esri
          Wayback capture so lines can be placed on clear ground (online-only). */}
      {isOnline && !wayback.error && (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarClock className="w-3.5 h-3.5 shrink-0" />
          <span className="shrink-0">{t('visual.imageryDate')}</span>
          <select
            value={satelliteDate}
            onChange={(e) => setSatelliteDate(e.target.value)}
            disabled={wayback.loading && wayback.releases.length === 0}
            className="flex-1 min-w-0 bg-transparent text-foreground/90 text-xs outline-none cursor-pointer border border-border rounded px-1 py-0.5"
            title={t('visual.imageryDateTitle')}
          >
            <option value="">{wayback.loading ? t('visual.loadingDates') : t('visual.latestDefault')}</option>
            {wayback.releases.map((r) => (
              <option key={r.releaseNum} value={r.date}>{r.date}</option>
            ))}
          </select>
        </label>
      )}
      <div
        ref={mapContainerRef}
        className="w-full h-64 sm:h-80 md:h-96 rounded-lg border border-border overflow-hidden"
      />
      {(drawMode || selectedLine !== null) && (
        <p className="text-xs text-muted-foreground text-center">
          {getHelperText()}
        </p>
      )}
    </div>
  );
}
