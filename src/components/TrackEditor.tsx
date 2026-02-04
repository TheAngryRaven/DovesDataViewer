import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, Edit2, Check, X, Settings, Map, FileText, Flag, Timer, Search, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Track, Course, TrackCourseSelection, SectorLine } from '@/types/racing';
import { 
  loadTracks, 
  addTrack as addTrackToStorage, 
  addCourse as addCourseToStorage,
  updateTrackName,
  updateCourse,
  deleteCourse,
  deleteTrack
} from '@/lib/trackStorage';
import { abbreviateTrackName } from '@/lib/trackUtils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import L from 'leaflet';

interface TrackCourseEditorProps {
  selection: TrackCourseSelection | null;
  onSelectionChange: (selection: TrackCourseSelection | null) => void;
  compact?: boolean;
}

interface CourseFormProps {
  trackName: string;
  courseName: string;
  latA: string;
  lonA: string;
  latB: string;
  lonB: string;
  sector2: { aLat: string; aLon: string; bLat: string; bLon: string };
  sector3: { aLat: string; aLon: string; bLat: string; bLon: string };
  onTrackNameChange: (value: string) => void;
  onCourseNameChange: (value: string) => void;
  onLatAChange: (value: string) => void;
  onLonAChange: (value: string) => void;
  onLatBChange: (value: string) => void;
  onLonBChange: (value: string) => void;
  onSector2Change: (field: 'aLat' | 'aLon' | 'bLat' | 'bLon', value: string) => void;
  onSector3Change: (field: 'aLat' | 'aLon' | 'bLat' | 'bLon', value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  showTrackName?: boolean;
}

function CourseForm({
  trackName, courseName, latA, lonA, latB, lonB,
  sector2, sector3,
  onTrackNameChange, onCourseNameChange,
  onLatAChange, onLonAChange, onLatBChange, onLonBChange,
  onSector2Change, onSector3Change,
  onSubmit, onCancel, submitLabel, showTrackName = true,
}: CourseFormProps) {
  const [showSectors, setShowSectors] = useState(
    Boolean(sector2.aLat || sector2.aLon || sector3.aLat || sector3.aLon)
  );
  const stopKeys = (e: React.KeyboardEvent<HTMLInputElement>) => e.stopPropagation();

  return (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
      {showTrackName && (
        <div>
          <Label htmlFor="trackName">Track Name</Label>
          <Input id="trackName" value={trackName} onChange={(e) => onTrackNameChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="e.g., Orlando Kart Center" className="font-mono" />
        </div>
      )}
      <div>
        <Label htmlFor="courseName">Course Name</Label>
        <Input id="courseName" value={courseName} onChange={(e) => onCourseNameChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="e.g., Full Track" className="font-mono" />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Start/Finish Line (required)</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Point A Lat</Label>
            <Input value={latA} onChange={(e) => onLatAChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="28.4127" className="font-mono text-sm" />
          </div>
          <div>
            <Label className="text-xs">Point A Lon</Label>
            <Input value={lonA} onChange={(e) => onLonAChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="-81.3797" className="font-mono text-sm" />
          </div>
          <div>
            <Label className="text-xs">Point B Lat</Label>
            <Input value={latB} onChange={(e) => onLatBChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="28.4128" className="font-mono text-sm" />
          </div>
          <div>
            <Label className="text-xs">Point B Lon</Label>
            <Input value={lonB} onChange={(e) => onLonBChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="-81.3795" className="font-mono text-sm" />
          </div>
        </div>
      </div>

      <Collapsible open={showSectors} onOpenChange={setShowSectors}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="w-full text-xs">
            {showSectors ? 'Hide Sector Lines (optional)' : 'Add Sector Lines (optional)'}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 mt-3">
          <p className="text-xs text-muted-foreground">Both sector 2 and sector 3 lines must be defined for sector timing to work.</p>
          
          <div className="space-y-2 p-3 border rounded bg-muted/20">
            <p className="text-sm font-medium text-purple-400">Sector 2 Line</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Point A Lat</Label>
                <Input value={sector2.aLat} onChange={(e) => onSector2Change('aLat', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lat" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point A Lon</Label>
                <Input value={sector2.aLon} onChange={(e) => onSector2Change('aLon', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lon" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point B Lat</Label>
                <Input value={sector2.bLat} onChange={(e) => onSector2Change('bLat', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lat" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point B Lon</Label>
                <Input value={sector2.bLon} onChange={(e) => onSector2Change('bLon', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lon" className="font-mono text-sm" />
              </div>
            </div>
          </div>

          <div className="space-y-2 p-3 border rounded bg-muted/20">
            <p className="text-sm font-medium text-purple-400">Sector 3 Line</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Point A Lat</Label>
                <Input value={sector3.aLat} onChange={(e) => onSector3Change('aLat', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lat" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point A Lon</Label>
                <Input value={sector3.aLon} onChange={(e) => onSector3Change('aLon', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lon" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point B Lat</Label>
                <Input value={sector3.bLat} onChange={(e) => onSector3Change('bLat', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lat" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point B Lon</Label>
                <Input value={sector3.bLon} onChange={(e) => onSector3Change('bLon', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lon" className="font-mono text-sm" />
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex gap-2 pt-2">
        <Button onClick={onSubmit} className="flex-1">
          <Check className="w-4 h-4 mr-2" />
          {submitLabel}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// Helper to parse sector line from form
function parseSectorLine(sector: { aLat: string; aLon: string; bLat: string; bLon: string }): SectorLine | undefined {
  const aLat = parseFloat(sector.aLat);
  const aLon = parseFloat(sector.aLon);
  const bLat = parseFloat(sector.bLat);
  const bLon = parseFloat(sector.bLon);
  if (isNaN(aLat) || isNaN(aLon) || isNaN(bLat) || isNaN(bLon)) return undefined;
  return { a: { lat: aLat, lon: aLon }, b: { lat: bLat, lon: bLon } };
}

type EditorMode = 'manual' | 'visual';
type VisualEditorTool = 'startFinish' | 'sector2' | 'sector3' | null;

interface GpsPoint {
  lat: number;
  lon: number;
}

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

function VisualEditor({ 
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

function EditorModeToggle({ mode, onModeChange }: EditorModeToggleProps) {
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

export function TrackEditor({ selection, onSelectionChange, compact = false }: TrackCourseEditorProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSelectDialogOpen, setIsSelectDialogOpen] = useState(false);
  const [isManageMode, setIsManageMode] = useState(false);
  const [isAddCourseOpen, setIsAddCourseOpen] = useState(false);
  const [isAddTrackOpen, setIsAddTrackOpen] = useState(false);
  const [tempTrackName, setTempTrackName] = useState<string>('');
  const [tempCourseName, setTempCourseName] = useState<string>('');
  const [formTrackName, setFormTrackName] = useState('');
  const [formCourseName, setFormCourseName] = useState('');
  const [formLatA, setFormLatA] = useState('');
  const [formLonA, setFormLonA] = useState('');
  const [formLatB, setFormLatB] = useState('');
  const [formLonB, setFormLonB] = useState('');
  const [formSector2, setFormSector2] = useState({ aLat: '', aLon: '', bLat: '', bLon: '' });
  const [formSector3, setFormSector3] = useState({ aLat: '', aLon: '', bLat: '', bLon: '' });
  const [editingCourse, setEditingCourse] = useState<{ trackName: string; courseName: string } | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>('manual');

  useEffect(() => {
    let mounted = true;
    loadTracks().then(loadedTracks => {
      if (mounted) { setTracks(loadedTracks); setIsLoading(false); }
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (isSelectDialogOpen && selection) {
      setTempTrackName(selection.trackName);
      setTempCourseName(selection.courseName);
    }
  }, [isSelectDialogOpen, selection]);

  const refreshTracks = useCallback(async () => {
    const loaded = await loadTracks();
    setTracks(loaded);
    return loaded;
  }, []);

  const resetForm = () => {
    setFormTrackName(''); setFormCourseName('');
    setFormLatA(''); setFormLonA(''); setFormLatB(''); setFormLonB('');
    setFormSector2({ aLat: '', aLon: '', bLat: '', bLon: '' });
    setFormSector3({ aLat: '', aLon: '', bLat: '', bLon: '' });
  };

  const selectedTrack = tracks.find(t => t.name === tempTrackName);
  const availableCourses = selectedTrack?.courses ?? [];

  const handleTrackChange = (trackName: string) => {
    setTempTrackName(trackName);
    const track = tracks.find(t => t.name === trackName);
    if (track && track.courses.length > 0) setTempCourseName(track.courses[0].name);
    else setTempCourseName('');
  };

  const handleCourseChange = (courseName: string) => setTempCourseName(courseName);

  const handleApplySelection = () => {
    if (!tempTrackName || !tempCourseName) { onSelectionChange(null); }
    else {
      const track = tracks.find(t => t.name === tempTrackName);
      const course = track?.courses.find(c => c.name === tempCourseName);
      if (track && course) onSelectionChange({ trackName: tempTrackName, courseName: tempCourseName, course });
    }
    setIsSelectDialogOpen(false);
    setIsManageMode(false);
  };

  const openAddCourse = () => {
    setFormTrackName(tempTrackName || '');
    resetForm();
    setFormTrackName(tempTrackName || '');
    setIsAddCourseOpen(true);
  };

  const openAddTrack = () => { resetForm(); setIsAddTrackOpen(true); };

  const buildCourse = (): Course | null => {
    const latA = parseFloat(formLatA); const lonA = parseFloat(formLonA);
    const latB = parseFloat(formLatB); const lonB = parseFloat(formLonB);
    if (!formCourseName.trim() || isNaN(latA) || isNaN(lonA) || isNaN(latB) || isNaN(lonB)) return null;
    const course: Course = {
      name: formCourseName.trim(),
      startFinishA: { lat: latA, lon: lonA },
      startFinishB: { lat: latB, lon: lonB },
      isUserDefined: true,
    };
    const s2 = parseSectorLine(formSector2);
    const s3 = parseSectorLine(formSector3);
    if (s2 && s3) { course.sector2 = s2; course.sector3 = s3; }
    return course;
  };

  const handleAddCourse = async () => {
    const course = buildCourse();
    if (!course || !formTrackName.trim()) return;
    await addCourseToStorage(formTrackName.trim(), course);
    await refreshTracks();
    setTempTrackName(formTrackName.trim());
    setTempCourseName(course.name);
    resetForm();
    setIsAddCourseOpen(false);
  };

  const handleAddTrack = async () => {
    const course = buildCourse();
    if (!course || !formTrackName.trim()) return;
    await addTrackToStorage(formTrackName.trim(), course);
    await refreshTracks();
    setTempTrackName(formTrackName.trim());
    setTempCourseName(course.name);
    resetForm();
    setIsAddTrackOpen(false);
  };

  const openEditCourse = (trackName: string, course: Course) => {
    setEditingCourse({ trackName, courseName: course.name });
    setFormTrackName(trackName);
    setFormCourseName(course.name);
    setFormLatA(course.startFinishA.lat.toString());
    setFormLonA(course.startFinishA.lon.toString());
    setFormLatB(course.startFinishB.lat.toString());
    setFormLonB(course.startFinishB.lon.toString());
    setFormSector2(course.sector2 ? {
      aLat: course.sector2.a.lat.toString(), aLon: course.sector2.a.lon.toString(),
      bLat: course.sector2.b.lat.toString(), bLon: course.sector2.b.lon.toString()
    } : { aLat: '', aLon: '', bLat: '', bLon: '' });
    setFormSector3(course.sector3 ? {
      aLat: course.sector3.a.lat.toString(), aLon: course.sector3.a.lon.toString(),
      bLat: course.sector3.b.lat.toString(), bLon: course.sector3.b.lon.toString()
    } : { aLat: '', aLon: '', bLat: '', bLon: '' });
  };

  const handleUpdateCourse = async () => {
    if (!editingCourse) return;
    const course = buildCourse();
    if (!course) return;
    if (course.name !== editingCourse.courseName) {
      await deleteCourse(editingCourse.trackName, editingCourse.courseName);
      await addCourseToStorage(editingCourse.trackName, course);
    } else {
      await updateCourse(editingCourse.trackName, editingCourse.courseName, {
        startFinishA: course.startFinishA,
        startFinishB: course.startFinishB,
        sector2: course.sector2,
        sector3: course.sector3,
      });
    }
    await refreshTracks();
    setTempCourseName(course.name);
    setEditingCourse(null);
    resetForm();
  };

  const handleDeleteCourse = async (trackName: string, courseName: string) => {
    await deleteCourse(trackName, courseName);
    const newTracks = await refreshTracks();
    if (tempTrackName === trackName && tempCourseName === courseName) {
      const track = newTracks.find(t => t.name === trackName);
      if (track && track.courses.length > 0) setTempCourseName(track.courses[0].name);
      else setTempCourseName('');
    }
  };

  const handleDeleteTrack = async (trackName: string) => {
    await deleteTrack(trackName);
    const newTracks = await refreshTracks();
    if (tempTrackName === trackName) {
      if (newTracks.length > 0) {
        setTempTrackName(newTracks[0].name);
        if (newTracks[0].courses.length > 0) setTempCourseName(newTracks[0].courses[0].name);
        else setTempCourseName('');
      } else { setTempTrackName(''); setTempCourseName(''); }
    }
  };

  const handleSector2Change = (field: 'aLat' | 'aLon' | 'bLat' | 'bLon', value: string) => {
    setFormSector2(prev => ({ ...prev, [field]: value }));
  };
  const handleSector3Change = (field: 'aLat' | 'aLon' | 'bLat' | 'bLon', value: string) => {
    setFormSector3(prev => ({ ...prev, [field]: value }));
  };

  if (isLoading) return <div className="text-muted-foreground text-sm">Loading tracks...</div>;

  const courseFormProps = {
    trackName: formTrackName, courseName: formCourseName,
    latA: formLatA, lonA: formLonA, latB: formLatB, lonB: formLonB,
    sector2: formSector2, sector3: formSector3,
    onTrackNameChange: setFormTrackName, onCourseNameChange: setFormCourseName,
    onLatAChange: setFormLatA, onLonAChange: setFormLonA,
    onLatBChange: setFormLatB, onLonBChange: setFormLonB,
    onSector2Change: handleSector2Change, onSector3Change: handleSector3Change,
  };

  if (compact) {
    const displayLabel = selection ? `${abbreviateTrackName(selection.trackName)} : ${selection.courseName}` : 'No track selected';

    return (
      <>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{displayLabel}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsSelectDialogOpen(true)}>
            <Edit2 className="w-4 h-4" />
          </Button>
        </div>

        <Dialog open={isSelectDialogOpen} onOpenChange={(open) => { setIsSelectDialogOpen(open); if (!open) { setIsManageMode(false); setEditingCourse(null); resetForm(); } }}>
          <DialogTrigger asChild><span className="sr-only">Open track selector</span></DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{isManageMode ? 'Manage Tracks & Courses' : 'Select Track & Course'}</DialogTitle></DialogHeader>
            {!isManageMode ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Track</Label>
                  <div className="flex gap-2">
                    <Select value={tempTrackName} onValueChange={handleTrackChange}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Select track..." /></SelectTrigger>
                      <SelectContent>{tracks.map(track => <SelectItem key={track.name} value={track.name}>{track.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button variant="outline" size="icon" onClick={openAddTrack}><Plus className="w-4 h-4" /></Button>
                  </div>
                </div>
                {tempTrackName && (
                  <div className="space-y-2">
                    <Label>Course</Label>
                    <div className="flex gap-2">
                      <Select value={tempCourseName} onValueChange={handleCourseChange} disabled={availableCourses.length === 0}>
                        <SelectTrigger className="flex-1"><SelectValue placeholder={availableCourses.length === 0 ? 'No courses' : 'Select course...'} /></SelectTrigger>
                        <SelectContent>{availableCourses.map(course => <SelectItem key={course.name} value={course.name}>{course.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button variant="outline" size="icon" onClick={openAddCourse}><Plus className="w-4 h-4" /></Button>
                    </div>
                  </div>
                )}
                <div className="flex gap-2 pt-4">
                  <Button onClick={handleApplySelection} className="flex-1">Apply</Button>
                  <Button variant="outline" onClick={() => setIsManageMode(true)}><Settings className="w-4 h-4 mr-2" />Manage</Button>
                </div>
              </div>
            ) : (
              <Tabs defaultValue="courses" className="w-full">
                <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="courses">Courses</TabsTrigger><TabsTrigger value="tracks">Tracks</TabsTrigger></TabsList>
                <TabsContent value="courses" className="space-y-4">
                  {editingCourse ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">Edit Course</h4>
                        <EditorModeToggle mode={editorMode} onModeChange={setEditorMode} />
                      </div>
                      {editorMode === 'manual' ? (
                        <CourseForm {...courseFormProps} onSubmit={handleUpdateCourse} onCancel={() => { setEditingCourse(null); resetForm(); setEditorMode('manual'); }} submitLabel="Update" showTrackName={false} />
                      ) : (
                        <div className="space-y-4">
                        <VisualEditor
                          startFinishA={formLatA && formLonA ? { lat: parseFloat(formLatA), lon: parseFloat(formLonA) } : null}
                          startFinishB={formLatB && formLonB ? { lat: parseFloat(formLatB), lon: parseFloat(formLonB) } : null}
                          sector2={parseSectorLine(formSector2)}
                          sector3={parseSectorLine(formSector3)}
                          onStartFinishChange={(a, b) => {
                            setFormLatA(a.lat.toString());
                            setFormLonA(a.lon.toString());
                            setFormLatB(b.lat.toString());
                            setFormLonB(b.lon.toString());
                          }}
                          onSector2Change={(line) => {
                            setFormSector2({
                              aLat: line.a.lat.toString(),
                              aLon: line.a.lon.toString(),
                              bLat: line.b.lat.toString(),
                              bLon: line.b.lon.toString(),
                            });
                          }}
                          onSector3Change={(line) => {
                            setFormSector3({
                              aLat: line.a.lat.toString(),
                              aLon: line.a.lon.toString(),
                              bLat: line.b.lat.toString(),
                              bLon: line.b.lon.toString(),
                            });
                          }}
                        />
                          <div className="flex gap-2">
                            <Button onClick={handleUpdateCourse} className="flex-1">
                              <Check className="w-4 h-4 mr-2" />
                              Update
                            </Button>
                            <Button variant="outline" onClick={() => { setEditingCourse(null); resetForm(); setEditorMode('manual'); }}>
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>Select track to view courses</Label>
                      <Select value={tempTrackName} onValueChange={handleTrackChange}>
                        <SelectTrigger><SelectValue placeholder="Select track..." /></SelectTrigger>
                        <SelectContent>{tracks.map(track => <SelectItem key={track.name} value={track.name}>{track.name}</SelectItem>)}</SelectContent>
                      </Select>
                      {selectedTrack && (
                        <div className="mt-4 space-y-2">
                          {selectedTrack.courses.length === 0 ? <p className="text-muted-foreground text-sm">No courses defined</p> : selectedTrack.courses.map(course => (
                            <div key={course.name} className="flex items-center justify-between p-2 border rounded bg-muted/30">
                              <div>
                                <span className="font-mono text-sm">{course.name}</span>
                                {!course.isUserDefined && <span className="ml-2 text-xs text-muted-foreground">(default)</span>}
                                {course.sector2 && course.sector3 && <span className="ml-2 text-xs text-purple-400">(sectors)</span>}
                              </div>
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditCourse(selectedTrack.name, course)}><Edit2 className="w-3 h-3" /></Button>
                                {course.isUserDefined && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteCourse(selectedTrack.name, course.name)}><Trash2 className="w-3 h-3" /></Button>}
                              </div>
                            </div>
                          ))}
                          <Button variant="outline" size="sm" onClick={openAddCourse} className="w-full mt-2"><Plus className="w-4 h-4 mr-2" />Add Course</Button>
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="tracks" className="space-y-2">
                  {tracks.length === 0 ? <p className="text-muted-foreground text-sm">No tracks defined</p> : tracks.map(track => (
                    <div key={track.name} className="flex items-center justify-between p-2 border rounded bg-muted/30">
                      <div>
                        <span className="font-mono text-sm">{track.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">({track.courses.length} course{track.courses.length !== 1 ? 's' : ''})</span>
                        {!track.isUserDefined && <span className="ml-2 text-xs text-muted-foreground">(default)</span>}
                      </div>
                      <div className="flex gap-1">{track.isUserDefined && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteTrack(track.name)}><Trash2 className="w-3 h-3" /></Button>}</div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={openAddTrack} className="w-full mt-2"><Plus className="w-4 h-4 mr-2" />Add Track</Button>
                </TabsContent>
                <div className="flex justify-end pt-4"><Button variant="outline" onClick={() => setIsManageMode(false)}>Back to Selection</Button></div>
              </Tabs>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={isAddCourseOpen} onOpenChange={(open) => { setIsAddCourseOpen(open); if (!open) setEditorMode('manual'); }}>
          <DialogTrigger asChild><span className="sr-only">Add course</span></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Course</DialogTitle>
            </DialogHeader>
            <EditorModeToggle mode={editorMode} onModeChange={setEditorMode} />
            {editorMode === 'manual' ? (
              <CourseForm {...courseFormProps} onSubmit={handleAddCourse} onCancel={() => { setIsAddCourseOpen(false); resetForm(); }} submitLabel="Create Course" />
            ) : (
              <div className="space-y-4">
                <VisualEditor
                  startFinishA={formLatA && formLonA ? { lat: parseFloat(formLatA), lon: parseFloat(formLonA) } : null}
                  startFinishB={formLatB && formLonB ? { lat: parseFloat(formLatB), lon: parseFloat(formLonB) } : null}
                  sector2={parseSectorLine(formSector2)}
                  sector3={parseSectorLine(formSector3)}
                  onStartFinishChange={(a, b) => {
                    setFormLatA(a.lat.toString());
                    setFormLonA(a.lon.toString());
                    setFormLatB(b.lat.toString());
                    setFormLonB(b.lon.toString());
                  }}
                  onSector2Change={(line) => {
                    setFormSector2({
                      aLat: line.a.lat.toString(),
                      aLon: line.a.lon.toString(),
                      bLat: line.b.lat.toString(),
                      bLon: line.b.lon.toString(),
                    });
                  }}
                  onSector3Change={(line) => {
                    setFormSector3({
                      aLat: line.a.lat.toString(),
                      aLon: line.a.lon.toString(),
                      bLat: line.b.lat.toString(),
                      bLon: line.b.lon.toString(),
                    });
                  }}
                />
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="addCourseName">Course Name</Label>
                    <Input id="addCourseName" value={formCourseName} onChange={(e) => setFormCourseName(e.target.value)} onKeyDownCapture={(e) => e.stopPropagation()} placeholder="e.g., Full Track" className="font-mono" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleAddCourse} className="flex-1" disabled={!formCourseName.trim() || !formLatA || !formLonA || !formLatB || !formLonB}>
                    <Check className="w-4 h-4 mr-2" />
                    Create Course
                  </Button>
                  <Button variant="outline" onClick={() => { setIsAddCourseOpen(false); resetForm(); }}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={isAddTrackOpen} onOpenChange={(open) => { setIsAddTrackOpen(open); if (!open) setEditorMode('manual'); }}>
          <DialogTrigger asChild><span className="sr-only">Add track</span></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Track</DialogTitle>
            </DialogHeader>
            <EditorModeToggle mode={editorMode} onModeChange={setEditorMode} />
            {editorMode === 'manual' ? (
              <CourseForm {...courseFormProps} onSubmit={handleAddTrack} onCancel={() => { setIsAddTrackOpen(false); resetForm(); }} submitLabel="Create Track" />
            ) : (
              <div className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="newTrackName">Track Name</Label>
                    <Input id="newTrackName" value={formTrackName} onChange={(e) => setFormTrackName(e.target.value)} onKeyDownCapture={(e) => e.stopPropagation()} placeholder="e.g., Orlando Kart Center" className="font-mono" />
                  </div>
                  <div>
                    <Label htmlFor="newCourseName">Course Name</Label>
                    <Input id="newCourseName" value={formCourseName} onChange={(e) => setFormCourseName(e.target.value)} onKeyDownCapture={(e) => e.stopPropagation()} placeholder="e.g., Full Track" className="font-mono" />
                  </div>
                </div>
                <VisualEditor
                  startFinishA={formLatA && formLonA ? { lat: parseFloat(formLatA), lon: parseFloat(formLonA) } : null}
                  startFinishB={formLatB && formLonB ? { lat: parseFloat(formLatB), lon: parseFloat(formLonB) } : null}
                  sector2={parseSectorLine(formSector2)}
                  sector3={parseSectorLine(formSector3)}
                  isNewTrack={true}
                  onStartFinishChange={(a, b) => {
                    setFormLatA(a.lat.toString());
                    setFormLonA(a.lon.toString());
                    setFormLatB(b.lat.toString());
                    setFormLonB(b.lon.toString());
                  }}
                  onSector2Change={(line) => {
                    setFormSector2({
                      aLat: line.a.lat.toString(),
                      aLon: line.a.lon.toString(),
                      bLat: line.b.lat.toString(),
                      bLon: line.b.lon.toString(),
                    });
                  }}
                  onSector3Change={(line) => {
                    setFormSector3({
                      aLat: line.a.lat.toString(),
                      aLon: line.a.lon.toString(),
                      bLat: line.b.lat.toString(),
                      bLon: line.b.lon.toString(),
                    });
                  }}
                />
                <div className="flex gap-2">
                  <Button onClick={handleAddTrack} className="flex-1" disabled={!formTrackName.trim() || !formCourseName.trim() || !formLatA || !formLonA || !formLatB || !formLonB}>
                    <Check className="w-4 h-4 mr-2" />
                    Create Track
                  </Button>
                  <Button variant="outline" onClick={() => { setIsAddTrackOpen(false); resetForm(); }}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Track</Label>
        <div className="flex gap-2">
          <Select value={tempTrackName} onValueChange={handleTrackChange}>
            <SelectTrigger className="flex-1"><SelectValue placeholder="Select track..." /></SelectTrigger>
            <SelectContent>{tracks.map(track => <SelectItem key={track.name} value={track.name}>{track.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={openAddTrack}><Plus className="w-4 h-4" /></Button>
        </div>
      </div>
      {tempTrackName && (
        <div className="space-y-2">
          <Label>Course</Label>
          <div className="flex gap-2">
            <Select value={tempCourseName} onValueChange={handleCourseChange} disabled={availableCourses.length === 0}>
              <SelectTrigger className="flex-1"><SelectValue placeholder={availableCourses.length === 0 ? 'No courses' : 'Select course...'} /></SelectTrigger>
              <SelectContent>{availableCourses.map(course => <SelectItem key={course.name} value={course.name}>{course.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={openAddCourse}><Plus className="w-4 h-4" /></Button>
          </div>
        </div>
      )}
      {tempTrackName && tempCourseName && (
        <Button onClick={() => {
          const track = tracks.find(t => t.name === tempTrackName);
          const course = track?.courses.find(c => c.name === tempCourseName);
          if (track && course) onSelectionChange({ trackName: tempTrackName, courseName: tempCourseName, course });
        }} className="w-full"><Check className="w-4 h-4 mr-2" />Apply Selection</Button>
      )}
      <Dialog open={isAddCourseOpen} onOpenChange={(open) => { setIsAddCourseOpen(open); if (!open) setEditorMode('manual'); }}>
        <DialogTrigger asChild><span className="sr-only">Add course</span></DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Course</DialogTitle>
          </DialogHeader>
          <EditorModeToggle mode={editorMode} onModeChange={setEditorMode} />
          {editorMode === 'manual' ? (
            <CourseForm {...courseFormProps} onSubmit={handleAddCourse} onCancel={() => { setIsAddCourseOpen(false); resetForm(); }} submitLabel="Create Course" />
          ) : (
            <div className="space-y-4">
              <VisualEditor
                startFinishA={formLatA && formLonA ? { lat: parseFloat(formLatA), lon: parseFloat(formLonA) } : null}
                startFinishB={formLatB && formLonB ? { lat: parseFloat(formLatB), lon: parseFloat(formLonB) } : null}
                sector2={parseSectorLine(formSector2)}
                sector3={parseSectorLine(formSector3)}
                onStartFinishChange={(a, b) => {
                  setFormLatA(a.lat.toString());
                  setFormLonA(a.lon.toString());
                  setFormLatB(b.lat.toString());
                  setFormLonB(b.lon.toString());
                }}
                onSector2Change={(line) => {
                  setFormSector2({
                    aLat: line.a.lat.toString(),
                    aLon: line.a.lon.toString(),
                    bLat: line.b.lat.toString(),
                    bLon: line.b.lon.toString(),
                  });
                }}
                onSector3Change={(line) => {
                  setFormSector3({
                    aLat: line.a.lat.toString(),
                    aLon: line.a.lon.toString(),
                    bLat: line.b.lat.toString(),
                    bLon: line.b.lon.toString(),
                  });
                }}
              />
              <div className="space-y-3">
                <div>
                  <Label htmlFor="addCourseNameNonCompact">Course Name</Label>
                  <Input id="addCourseNameNonCompact" value={formCourseName} onChange={(e) => setFormCourseName(e.target.value)} onKeyDownCapture={(e) => e.stopPropagation()} placeholder="e.g., Full Track" className="font-mono" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAddCourse} className="flex-1" disabled={!formCourseName.trim() || !formLatA || !formLonA || !formLatB || !formLonB}>
                  <Check className="w-4 h-4 mr-2" />
                  Create Course
                </Button>
                <Button variant="outline" onClick={() => { setIsAddCourseOpen(false); resetForm(); }}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={isAddTrackOpen} onOpenChange={(open) => { setIsAddTrackOpen(open); if (!open) setEditorMode('manual'); }}>
        <DialogTrigger asChild><span className="sr-only">Add track</span></DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Track</DialogTitle>
          </DialogHeader>
          <EditorModeToggle mode={editorMode} onModeChange={setEditorMode} />
          {editorMode === 'manual' ? (
            <CourseForm {...courseFormProps} onSubmit={handleAddTrack} onCancel={() => { setIsAddTrackOpen(false); resetForm(); }} submitLabel="Create Track" />
          ) : (
            <div className="space-y-4">
              <VisualEditor
                startFinishA={formLatA && formLonA ? { lat: parseFloat(formLatA), lon: parseFloat(formLonA) } : null}
                startFinishB={formLatB && formLonB ? { lat: parseFloat(formLatB), lon: parseFloat(formLonB) } : null}
                sector2={parseSectorLine(formSector2)}
                sector3={parseSectorLine(formSector3)}
                isNewTrack={true}
                onStartFinishChange={(a, b) => {
                  setFormLatA(a.lat.toString());
                  setFormLonA(a.lon.toString());
                  setFormLatB(b.lat.toString());
                  setFormLonB(b.lon.toString());
                }}
                onSector2Change={(line) => {
                  setFormSector2({
                    aLat: line.a.lat.toString(),
                    aLon: line.a.lon.toString(),
                    bLat: line.b.lat.toString(),
                    bLon: line.b.lon.toString(),
                  });
                }}
                onSector3Change={(line) => {
                  setFormSector3({
                    aLat: line.a.lat.toString(),
                    aLon: line.a.lon.toString(),
                    bLat: line.b.lat.toString(),
                    bLon: line.b.lon.toString(),
                  });
                }}
              />
              <div className="space-y-3">
                <div>
                  <Label htmlFor="newTrackNameNonCompact">Track Name</Label>
                  <Input id="newTrackNameNonCompact" value={formTrackName} onChange={(e) => setFormTrackName(e.target.value)} onKeyDownCapture={(e) => e.stopPropagation()} placeholder="e.g., Orlando Kart Center" className="font-mono" />
                </div>
                <div>
                  <Label htmlFor="newCourseNameNonCompact">Course Name</Label>
                  <Input id="newCourseNameNonCompact" value={formCourseName} onChange={(e) => setFormCourseName(e.target.value)} onKeyDownCapture={(e) => e.stopPropagation()} placeholder="e.g., Full Track" className="font-mono" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAddTrack} className="flex-1" disabled={!formTrackName.trim() || !formCourseName.trim() || !formLatA || !formLonA || !formLatB || !formLonB}>
                  <Check className="w-4 h-4 mr-2" />
                  Create Track
                </Button>
                <Button variant="outline" onClick={() => { setIsAddTrackOpen(false); resetForm(); }}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}