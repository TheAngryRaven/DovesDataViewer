import { useState, useEffect, useCallback, useRef } from 'react';
import { Flag, Timer, Check, Search, Loader2, FileText, Map } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { SectorLine } from '@/types/racing';
import L from 'leaflet';

export interface GpsPoint {
  lat: number;
  lon: number;
}

export type VisualEditorTool = 'startFinish' | 'sector2' | 'sector3' | null;
export type EditorMode = 'manual' | 'visual';

interface VisualEditorProps {
  startFinishA: GpsPoint | null;
  startFinishB: GpsPoint | null;
  sector2: SectorLine | undefined;
  sector3: SectorLine | undefined;
  onStartFinishChange?: (a: GpsPoint, b: GpsPoint) => void;
  onSector2Change?: (line: SectorLine) => void;
  onSector3Change?: (line: SectorLine) => void;
  onDone?: () => void;
  isNewTrack?: boolean;
}

interface VisualEditorToolbarProps {
  activeTool: VisualEditorTool;
  onToolChange: (tool: VisualEditorTool) => void;
  onDone: () => void;
}

function VisualEditorToolbar({ activeTool, onToolChange, onDone }: VisualEditorToolbarProps) {
  const handleStartFinish = () => {
    onToolChange(activeTool === 'startFinish' ? null : 'startFinish');
  };

  const handleSector2 = () => {
    onToolChange(activeTool === 'sector2' ? null : 'sector2');
  };

  const handleSector3 = () => {
    onToolChange(activeTool === 'sector3' ? null : 'sector3');
  };

  const handleDone = () => {
    onDone();
  };

  return (
    <div className="flex items-center gap-2 p-2 bg-card border border-border rounded-lg">
      <Button
        variant={activeTool === 'startFinish' ? 'default' : 'outline'}
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={handleStartFinish}
      >
        <Flag className="w-3.5 h-3.5" />
        Start/Finish
      </Button>
      <Button
        variant={activeTool === 'sector2' ? 'default' : 'outline'}
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={handleSector2}
      >
        <Timer className="w-3.5 h-3.5" />
        Sector 2
      </Button>
      <Button
        variant={activeTool === 'sector3' ? 'default' : 'outline'}
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={handleSector3}
      >
        <Timer className="w-3.5 h-3.5" />
        Sector 3
      </Button>
      <div className="flex-1" />
      <Button
        variant="secondary"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={handleDone}
      >
        <Check className="w-3.5 h-3.5" />
        Done
      </Button>
    </div>
  );
}

export function VisualEditor({
  startFinishA, startFinishB, sector2, sector3,
  onStartFinishChange, onSector2Change, onSector3Change, onDone,
  isNewTrack = false
}: VisualEditorProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [activeTool, setActiveTool] = useState<VisualEditorTool>(null);

  // Pending coordinates while dragging
  const [pendingStartFinish, setPendingStartFinish] = useState<{ a: GpsPoint; b: GpsPoint } | null>(null);
  const [pendingSector2, setPendingSector2] = useState<SectorLine | null>(null);
  const [pendingSector3, setPendingSector3] = useState<SectorLine | null>(null);

  // Layer refs for markers and active polyline
  const markersRef = useRef<L.Marker[]>([]);
  const activeLineRef = useRef<L.Polyline | null>(null);
  const staticLinesRef = useRef<L.Polyline[]>([]);

  // Location search state (only used when isNewTrack)
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Create a new ~30m horizontal line at the map center
  const createLineAtMapCenter = useCallback((tool: VisualEditorTool): { a: GpsPoint; b: GpsPoint } | null => {
    const map = mapRef.current;
    if (!map || !tool) return null;

    const center = map.getCenter();
    // ~0.00015 degrees longitude ≈ ~15 meters at most latitudes
    const offset = 0.00015;
    const newLine = {
      a: { lat: center.lat, lon: center.lng - offset },
      b: { lat: center.lat, lon: center.lng + offset },
    };

    // Set pending state for the line
    if (tool === 'startFinish') {
      setPendingStartFinish(newLine);
    } else if (tool === 'sector2') {
      setPendingSector2(newLine);
    } else if (tool === 'sector3') {
      setPendingSector3(newLine);
    }

    return newLine;
  }, []);

  // Location search using Nominatim
  const handleLocationSearch = useCallback(async () => {
    if (!searchQuery.trim() || !mapRef.current) return;

    setIsSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery.trim())}`,
        {
          headers: {
            'User-Agent': 'DovesDataViewer/1.0',
          },
        }
      );
      const results = await response.json();

      if (results && results.length > 0) {
        const { lat, lon } = results[0];
        mapRef.current.setView([parseFloat(lat), parseFloat(lon)], 17, { animate: true });
        setSearchQuery('');
      } else {
        toast({
          title: 'Location not found',
          description: 'Try a different search term',
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: 'Search failed',
        description: 'Could not search for location',
        variant: 'destructive',
      });
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  // Calculate center from existing points or default to Orlando Kart Center
  const getInitialCenter = (): [number, number] => {
    if (startFinishA && startFinishB) {
      return [(startFinishA.lat + startFinishB.lat) / 2, (startFinishA.lon + startFinishB.lon) / 2];
    }
    return [28.4120, -81.3797];
  };

  // Get line coordinates for a specific tool
  const getLineCoords = (tool: VisualEditorTool): { a: GpsPoint; b: GpsPoint } | null => {
    if (tool === 'startFinish') {
      if (pendingStartFinish) return pendingStartFinish;
      if (startFinishA && startFinishB) return { a: startFinishA, b: startFinishB };
    } else if (tool === 'sector2') {
      if (pendingSector2) return { a: pendingSector2.a, b: pendingSector2.b };
      if (sector2) return { a: sector2.a, b: sector2.b };
    } else if (tool === 'sector3') {
      if (pendingSector3) return { a: pendingSector3.a, b: pendingSector3.b };
      if (sector3) return { a: sector3.a, b: sector3.b };
    }
    return null;
  };

  // Clear interactive editing layers
  const clearEditingLayers = () => {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (activeLineRef.current) {
      activeLineRef.current.remove();
      activeLineRef.current = null;
    }
  };

  // Draw static lines (non-active lines, dimmed)
  const drawStaticLines = (map: L.Map, excludeTool: VisualEditorTool) => {
    staticLinesRef.current.forEach(l => l.remove());
    staticLinesRef.current = [];

    const lines: { coords: GpsPoint[]; color: string; isActive: boolean }[] = [];

    // Start/Finish line
    if (startFinishA && startFinishB) {
      const isActive = excludeTool === 'startFinish';
      const coords = pendingStartFinish && isActive
        ? [pendingStartFinish.a, pendingStartFinish.b]
        : [startFinishA, startFinishB];
      if (!isActive) {
        lines.push({ coords, color: '#22c55e', isActive });
      }
    }

    // Sector 2 line
    if (sector2) {
      const isActive = excludeTool === 'sector2';
      const coords = pendingSector2 && isActive
        ? [pendingSector2.a, pendingSector2.b]
        : [sector2.a, sector2.b];
      if (!isActive) {
        lines.push({ coords, color: '#a855f7', isActive });
      }
    }

    // Sector 3 line
    if (sector3) {
      const isActive = excludeTool === 'sector3';
      const coords = pendingSector3 && isActive
        ? [pendingSector3.a, pendingSector3.b]
        : [sector3.a, sector3.b];
      if (!isActive) {
        lines.push({ coords, color: '#a855f7', isActive });
      }
    }

    lines.forEach(({ coords, color }) => {
      const polyline = L.polyline(
        coords.map(p => [p.lat, p.lon] as [number, number]),
        { color, weight: 2, opacity: 0.5 }
      ).addTo(map);
      staticLinesRef.current.push(polyline);
    });
  };

  // Create draggable markers and active line for the selected tool
  // If coords is provided, use it directly (avoids async state issues)
  const createEditingLayersWithCoords = (map: L.Map, tool: VisualEditorTool, coords: { a: GpsPoint; b: GpsPoint }) => {
    clearEditingLayers();
    if (!tool) return;

    const color = tool === 'startFinish' ? '#22c55e' : '#a855f7';

    // Create the active polyline
    const polyline = L.polyline(
      [[coords.a.lat, coords.a.lon], [coords.b.lat, coords.b.lon]],
      { color, weight: 4, opacity: 1 }
    ).addTo(map);
    activeLineRef.current = polyline;

    // Create draggable markers
    const createMarker = (point: GpsPoint, isPointA: boolean) => {
      const marker = L.marker([point.lat, point.lon], {
        draggable: true,
        icon: L.divIcon({
          className: 'custom-marker',
          html: `<div style="
            width: 16px;
            height: 16px;
            background: ${color};
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 2px 6px rgba(0,0,0,0.5);
          "></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
      }).addTo(map);

      marker.on('drag', (e: L.LeafletEvent) => {
        const latlng = (e.target as L.Marker).getLatLng();

        // Update polyline in real-time
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

        if (tool === 'startFinish') {
          setPendingStartFinish({ a: newA, b: newB });
        } else if (tool === 'sector2') {
          setPendingSector2({ a: newA, b: newB });
        } else if (tool === 'sector3') {
          setPendingSector3({ a: newA, b: newB });
        }
      });

      return marker;
    };

    const markerA = createMarker(coords.a, true);
    const markerB = createMarker(coords.b, false);
    markersRef.current = [markerA, markerB];
  };

  // Convenience wrapper that reads coords from state
  const createEditingLayers = (map: L.Map, tool: VisualEditorTool) => {
    if (!tool) return;
    const lineCoords = getLineCoords(tool);
    if (!lineCoords) return;
    createEditingLayersWithCoords(map, tool, lineCoords);
  };

  const handleToolChange = (tool: VisualEditorTool) => {
    const map = mapRef.current;

    // If switching away from a tool without clicking Done, discard pending changes
    if (activeTool && activeTool !== tool) {
      if (activeTool === 'startFinish') setPendingStartFinish(null);
      else if (activeTool === 'sector2') setPendingSector2(null);
      else if (activeTool === 'sector3') setPendingSector3(null);
    }

    setActiveTool(tool);

    if (map && tool) {
      let lineCoords = getLineCoords(tool);

      // If no line exists, create one at map center
      if (!lineCoords) {
        lineCoords = createLineAtMapCenter(tool);
      }

      if (lineCoords) {
        // Fit map bounds to the selected line with padding
        const bounds = L.latLngBounds(
          [lineCoords.a.lat, lineCoords.a.lon],
          [lineCoords.b.lat, lineCoords.b.lon]
        );
        map.fitBounds(bounds, {
          padding: [80, 80],
          maxZoom: 20,
          animate: true
        });

        // Create layers directly with the known coordinates (avoids async state issue)
        drawStaticLines(map, tool);
        createEditingLayersWithCoords(map, tool, lineCoords);
      }
    } else if (map && !tool) {
      // No tool selected, clear editing layers and redraw all static
      clearEditingLayers();
      drawStaticLines(map, null);
    }
  };

  const handleDone = () => {
    // Apply pending changes via callbacks
    if (activeTool === 'startFinish' && pendingStartFinish && onStartFinishChange) {
      onStartFinishChange(pendingStartFinish.a, pendingStartFinish.b);
      setPendingStartFinish(null);
    } else if (activeTool === 'sector2' && pendingSector2 && onSector2Change) {
      onSector2Change(pendingSector2);
      setPendingSector2(null);
    } else if (activeTool === 'sector3' && pendingSector3 && onSector3Change) {
      onSector3Change(pendingSector3);
      setPendingSector3(null);
    }

    // Clear editing state
    clearEditingLayers();
    setActiveTool(null);

    // Redraw static lines
    if (mapRef.current) {
      drawStaticLines(mapRef.current, null);
    }

    // Call parent onDone if provided
    if (onDone) {
      onDone();
    }
  };

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const center = getInitialCenter();
    const map = L.map(mapContainerRef.current, {
      center,
      zoom: 18,
      zoomControl: true,
    });

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles © Esri',
      maxZoom: 21,
    }).addTo(map);

    mapRef.current = map;

    // Draw initial static lines
    drawStaticLines(map, null);

    return () => {
      clearEditingLayers();
      staticLinesRef.current.forEach(l => l.remove());
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Handle resize
  useEffect(() => {
    if (!mapRef.current || !mapContainerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      mapRef.current?.invalidateSize();
    });

    resizeObserver.observe(mapContainerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Update layers when activeTool changes
  useEffect(() => {
    if (!mapRef.current) return;

    if (activeTool) {
      drawStaticLines(mapRef.current, activeTool);
      createEditingLayers(mapRef.current, activeTool);
    } else {
      clearEditingLayers();
      drawStaticLines(mapRef.current, null);
    }
  }, [activeTool, pendingStartFinish, pendingSector2, pendingSector3]);

  const getHelperText = (): string => {
    if (!activeTool) return '';
    const lineCoords = getLineCoords(activeTool);
    if (!lineCoords) {
      return `No ${activeTool === 'startFinish' ? 'Start/Finish' : activeTool === 'sector2' ? 'Sector 2' : 'Sector 3'} line defined`;
    }
    const toolName = activeTool === 'startFinish' ? 'Start/Finish' : activeTool === 'sector2' ? 'Sector 2' : 'Sector 3';
    return `Drag the markers to adjust the ${toolName} line`;
  };

  return (
    <div className="space-y-3">
      {isNewTrack && (
        <div className="flex gap-2">
          <Input
            placeholder="Search location..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') handleLocationSearch();
            }}
            className="flex-1 h-8 text-sm"
            disabled={isSearching || !mapRef.current}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3"
            onClick={handleLocationSearch}
            disabled={isSearching || !searchQuery.trim() || !mapRef.current}
          >
            {isSearching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
          </Button>
        </div>
      )}
      <VisualEditorToolbar
        activeTool={activeTool}
        onToolChange={handleToolChange}
        onDone={handleDone}
      />
      <div
        ref={mapContainerRef}
        className="w-full h-64 rounded-lg border border-border overflow-hidden"
      />
      {activeTool && (
        <p className="text-xs text-muted-foreground text-center">
          {getHelperText()}
        </p>
      )}
    </div>
  );
}

interface EditorModeToggleProps {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
}

export function EditorModeToggle({ mode, onModeChange }: EditorModeToggleProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit">
      <Button
        variant={mode === 'manual' ? 'default' : 'ghost'}
        size="sm"
        className="h-7 px-3 text-xs gap-1.5"
        onClick={() => onModeChange('manual')}
      >
        <FileText className="w-3.5 h-3.5" />
        Manual
      </Button>
      <Button
        variant={mode === 'visual' ? 'default' : 'ghost'}
        size="sm"
        className="h-7 px-3 text-xs gap-1.5"
        onClick={() => onModeChange('visual')}
      >
        <Map className="w-3.5 h-3.5" />
        Visual
      </Button>
    </div>
  );
}
