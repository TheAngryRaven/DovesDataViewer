import { useState, useCallback, useMemo } from 'react';
import { Gauge, Map, ListOrdered, Settings } from 'lucide-react';
import { FileImport } from '@/components/FileImport';
import { TrackEditor } from '@/components/TrackEditor';
import { RaceLineView } from '@/components/RaceLineView';
import { TelemetryChart } from '@/components/TelemetryChart';
import { LapTable } from '@/components/LapTable';
import { ResizableSplit } from '@/components/ResizableSplit';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ParsedData, Track, Lap, FieldMapping, GpsSample } from '@/types/racing';
import { calculateLaps } from '@/lib/lapCalculation';

type TopPanelView = 'raceline' | 'laptable';

export default function Index() {
  const [data, setData] = useState<ParsedData | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [topPanelView, setTopPanelView] = useState<TopPanelView>('raceline');
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [laps, setLaps] = useState<Lap[]>([]);
  const [selectedLapNumber, setSelectedLapNumber] = useState<number | null>(null);

  // Filter samples to selected lap
  const filteredSamples = useMemo((): GpsSample[] => {
    if (!data) return [];
    if (selectedLapNumber === null) return data.samples;
    
    const lap = laps.find(l => l.lapNumber === selectedLapNumber);
    if (!lap) return data.samples;
    
    return data.samples.slice(lap.startIndex, lap.endIndex + 1);
  }, [data, laps, selectedLapNumber]);

  // Compute bounds for filtered samples
  const filteredBounds = useMemo(() => {
    if (filteredSamples.length === 0) return data?.bounds;
    
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    
    for (const s of filteredSamples) {
      if (s.lat < minLat) minLat = s.lat;
      if (s.lat > maxLat) maxLat = s.lat;
      if (s.lon < minLon) minLon = s.lon;
      if (s.lon > maxLon) maxLon = s.lon;
    }
    
    return { minLat, maxLat, minLon, maxLon };
  }, [filteredSamples, data?.bounds]);

  const handleDataLoaded = useCallback((parsedData: ParsedData) => {
    setData(parsedData);
    setFieldMappings(parsedData.fieldMappings);
    setCurrentIndex(0);
    
    // Calculate laps if track is selected
    if (selectedTrack) {
      const computedLaps = calculateLaps(parsedData.samples, selectedTrack);
      setLaps(computedLaps);
    }
  }, [selectedTrack]);

  const handleTrackSelect = useCallback((track: Track | null) => {
    setSelectedTrack(track);
    
    // Recalculate laps
    if (track && data) {
      const computedLaps = calculateLaps(data.samples, track);
      setLaps(computedLaps);
    } else {
      setLaps([]);
    }
  }, [data]);

  const handleScrub = useCallback((index: number) => {
    setCurrentIndex(index);
  }, []);

  const handleFieldToggle = useCallback((fieldName: string) => {
    setFieldMappings(prev => prev.map(f => 
      f.name === fieldName ? { ...f, enabled: !f.enabled } : f
    ));
  }, []);

  const handleLapSelect = useCallback((lap: Lap) => {
    setSelectedLapNumber(lap.lapNumber);
    setCurrentIndex(0); // Reset to start of lap
    setTopPanelView('raceline');
  }, []);

  const handleLapDropdownChange = useCallback((value: string) => {
    if (value === 'all') {
      setSelectedLapNumber(null);
      setCurrentIndex(0);
    } else {
      const lapNum = parseInt(value, 10);
      setSelectedLapNumber(lapNum);
      setCurrentIndex(0);
    }
  }, []);

  // No data loaded - show import UI
  if (!data) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header */}
        <header className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <Gauge className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-xl font-semibold text-foreground">Racing Datalog Viewer</h1>
              <p className="text-sm text-muted-foreground">NMEA Enhanced Format</p>
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-xl space-y-6">
            <FileImport onDataLoaded={handleDataLoaded} />
            
            <div className="racing-card p-4">
              <TrackEditor 
                selectedTrack={selectedTrack} 
                onTrackSelect={handleTrackSelect} 
              />
            </div>

            <div className="text-center text-sm text-muted-foreground space-y-3">
              <p>Drop a CSV or NMEA file to get started.</p>
              <p>Track definitions are saved in your browser.</p>
              
              <div className="mt-4 p-4 bg-muted/30 rounded-lg text-left border border-border/50">
                <h3 className="font-medium text-foreground mb-2">NMEA Enhanced Format</h3>
                <p className="text-xs leading-relaxed">
                  This viewer supports <span className="font-medium text-foreground">NMEA Enhanced</span> format — 
                  standard NMEA sentences (RMC, GGA) organized as tab-delimited CSV with optional 
                  additional data columns. Simply export your GPS logger data with NMEA strings in 
                  one column, and any extra telemetry (RPM, throttle, etc.) in additional columns.
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Data loaded - show main view
  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-border px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Gauge className="w-6 h-6 text-primary" />
          <span className="font-semibold text-foreground">Racing Datalog</span>
        </div>

        <div className="flex items-center gap-4">
          {/* Track selector (compact) */}
          <div className="flex items-center gap-2">
            <TrackEditor 
              selectedTrack={selectedTrack} 
              onTrackSelect={handleTrackSelect} 
            />
          </div>

          {/* Lap selector dropdown */}
          {laps.length > 0 && (
            <Select 
              value={selectedLapNumber?.toString() ?? 'all'} 
              onValueChange={handleLapDropdownChange}
            >
              <SelectTrigger className="w-[140px] h-8 text-sm">
                <SelectValue placeholder="All Laps" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Laps</SelectItem>
                {laps.map(lap => (
                  <SelectItem key={lap.lapNumber} value={lap.lapNumber.toString()}>
                    Lap {lap.lapNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Current values readout */}
          {filteredSamples[currentIndex] && (
            <div className="flex items-center gap-4 text-sm font-mono bg-muted/50 px-3 py-1.5 rounded">
              <span className="text-racing-telemetrySpeed">
                {filteredSamples[currentIndex].speedMph.toFixed(1)} mph
              </span>
              {fieldMappings.filter(f => f.enabled).slice(0, 2).map((field, idx) => (
                <span key={field.name} className="text-muted-foreground">
                  {field.name}: {(filteredSamples[currentIndex].extraFields[field.name] ?? 0).toFixed(1)}
                </span>
              ))}
            </div>
          )}

          {/* New file button */}
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setData(null)}
          >
            <Settings className="w-4 h-4 mr-2" />
            New File
          </Button>
        </div>
      </header>

      {/* Main split view */}
      <main className="flex-1 overflow-hidden">
        <ResizableSplit
          defaultRatio={0.7}
          topPanel={
            <div className="h-full flex flex-col">
              {/* View toggle tabs */}
              <div className="flex border-b border-border shrink-0">
                <button
                  onClick={() => setTopPanelView('raceline')}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors
                    ${topPanelView === 'raceline' 
                      ? 'text-primary border-b-2 border-primary bg-primary/5' 
                      : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Map className="w-4 h-4" />
                  Race Line
                </button>
                <button
                  onClick={() => setTopPanelView('laptable')}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors
                    ${topPanelView === 'laptable' 
                      ? 'text-primary border-b-2 border-primary bg-primary/5' 
                      : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <ListOrdered className="w-4 h-4" />
                  Lap Times
                  {laps.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary/20 text-primary rounded">
                      {laps.length}
                    </span>
                  )}
                </button>
              </div>

              {/* Panel content */}
              <div className="flex-1 overflow-hidden">
                {topPanelView === 'raceline' ? (
                  <RaceLineView
                    samples={filteredSamples}
                    currentIndex={currentIndex}
                    track={selectedTrack}
                    bounds={filteredBounds}
                  />
                ) : (
                  <LapTable 
                    laps={laps} 
                    onLapSelect={handleLapSelect}
                    selectedLapNumber={selectedLapNumber}
                  />
                )}
              </div>
            </div>
          }
          bottomPanel={
            <TelemetryChart
              samples={filteredSamples}
              fieldMappings={fieldMappings}
              currentIndex={currentIndex}
              onScrub={handleScrub}
              onFieldToggle={handleFieldToggle}
            />
          }
        />
      </main>
    </div>
  );
}
